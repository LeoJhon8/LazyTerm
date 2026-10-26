/* Private implementation included by wrapper.c. Channel callbacks can run on
 * worker threads; owned payloads cross into the session thread under this lock. */
#define LAZY_TEXT_LIMIT (4u * 1024u * 1024u)
#define LAZY_CF_UNICODETEXT 13u

typedef struct LazyFreeRdpEvent
{
    uint32_t kind, width, height, x, y;
    uint8_t* data;
    uint32_t length;
} LazyFreeRdpEvent;

static UINT lazy_clipboard_announce(LazyFreeRdpClient* client)
{
    CLIPRDR_FORMAT format = { LAZY_CF_UNICODETEXT, NULL };
    CLIPRDR_FORMAT_LIST list = { 0 };
    list.common.msgType = CB_FORMAT_LIST;
    list.numFormats = client->local_text ? 1 : 0;
    list.formats = &format;
    UINT rc = client->clipboard->ClientFormatList(client->clipboard, &list);
    client->clipboard_announcement_pending = rc == CHANNEL_RC_OK;
    return rc;
}

static UINT lazy_clipboard_caps(CliprdrClientContext* context, const CLIPRDR_CAPABILITIES* caps)
{
    (void)context;
    (void)caps;
    return CHANNEL_RC_OK;
}

static UINT lazy_clipboard_ready(CliprdrClientContext* context, const CLIPRDR_MONITOR_READY* ready)
{
    (void)ready;
    LazyFreeRdpClient* client = context->custom;
    CLIPRDR_GENERAL_CAPABILITY_SET general = { CB_CAPSTYPE_GENERAL, CB_CAPSTYPE_GENERAL_LEN,
                                               CB_CAPS_VERSION_2, CB_USE_LONG_FORMAT_NAMES };
    CLIPRDR_CAPABILITIES caps = { 0 };
    caps.common.msgType = CB_CLIP_CAPS;
    caps.cCapabilitiesSets = 1;
    caps.capabilitySets = (CLIPRDR_CAPABILITY_SET*)&general;
    UINT rc = context->ClientCapabilities(context, &caps);
    if (rc != CHANNEL_RC_OK)
        return rc;
    EnterCriticalSection(&client->extension_lock);
    client->clipboard_ready = TRUE;
    rc = lazy_clipboard_announce(client);
    LeaveCriticalSection(&client->extension_lock);
    return rc;
}

static UINT lazy_clipboard_request(CliprdrClientContext* context)
{
    CLIPRDR_FORMAT_DATA_REQUEST request = { 0 };
    request.common.msgType = CB_FORMAT_DATA_REQUEST;
    request.requestedFormatId = LAZY_CF_UNICODETEXT;
    return context->ClientFormatDataRequest(context, &request);
}

static UINT lazy_clipboard_list(CliprdrClientContext* context, const CLIPRDR_FORMAT_LIST* list)
{
    LazyFreeRdpClient* client = context->custom;
    CLIPRDR_FORMAT_LIST_RESPONSE response = { 0 };
    response.common.msgType = CB_FORMAT_LIST_RESPONSE;
    response.common.msgFlags = CB_RESPONSE_OK;
    UINT rc = context->ClientFormatListResponse(context, &response);
    if (rc != CHANNEL_RC_OK)
        return rc;
    EnterCriticalSection(&client->extension_lock);
    client->remote_has_text = FALSE;
    client->remote_text_ready = FALSE;
    for (UINT32 i = 0; i < list->numFormats; i++)
        if (list->formats[i].formatId == LAZY_CF_UNICODETEXT)
            client->remote_has_text = TRUE;
    if (client->clipboard_request_pending)
        client->clipboard_request_again = TRUE;
    else if (client->remote_has_text)
    {
        rc = lazy_clipboard_request(context);
        client->clipboard_request_pending = rc == CHANNEL_RC_OK;
    }
    LeaveCriticalSection(&client->extension_lock);
    return rc;
}

static UINT lazy_clipboard_ack(CliprdrClientContext* context, const CLIPRDR_FORMAT_LIST_RESPONSE* response)
{
    LazyFreeRdpClient* client = context->custom;
    EnterCriticalSection(&client->extension_lock);
    client->clipboard_announcement_pending = FALSE;
    if (client->paste_pending)
    {
        client->paste_ready = (response->common.msgFlags & CB_RESPONSE_OK) != 0;
        client->paste_failed = !client->paste_ready;
        client->paste_pending = FALSE;
    }
    LeaveCriticalSection(&client->extension_lock);
    return CHANNEL_RC_OK;
}

static UINT lazy_clipboard_data_request(CliprdrClientContext* context, const CLIPRDR_FORMAT_DATA_REQUEST* request)
{
    LazyFreeRdpClient* client = context->custom;
    CLIPRDR_FORMAT_DATA_RESPONSE response = { 0 };
    response.common.msgType = CB_FORMAT_DATA_RESPONSE;
    EnterCriticalSection(&client->extension_lock);
    if (request->requestedFormatId == LAZY_CF_UNICODETEXT && client->local_text)
    {
        response.common.msgFlags = CB_RESPONSE_OK;
        response.common.dataLen = client->local_text_len;
        response.requestedFormatData = client->local_text;
    }
    else
        response.common.msgFlags = CB_RESPONSE_FAIL;
    UINT rc = context->ClientFormatDataResponse(context, &response);
    LeaveCriticalSection(&client->extension_lock);
    return rc;
}

static UINT lazy_clipboard_data_response(CliprdrClientContext* context, const CLIPRDR_FORMAT_DATA_RESPONSE* response)
{
    LazyFreeRdpClient* client = context->custom;
    UINT rc = CHANNEL_RC_OK;
    EnterCriticalSection(&client->extension_lock);
    if (client->clipboard_request_pending && !client->clipboard_request_again && client->remote_has_text &&
        (response->common.msgFlags & CB_RESPONSE_OK) && response->requestedFormatData &&
        response->common.dataLen >= 2 && response->common.dataLen <= LAZY_TEXT_LIMIT &&
        response->common.dataLen % 2 == 0)
    {
        BYTE* copy = malloc(response->common.dataLen);
        if (copy)
        {
            memcpy(copy, response->requestedFormatData, response->common.dataLen);
            free(client->remote_text);
            client->remote_text = copy;
            client->remote_text_len = response->common.dataLen;
            client->remote_text_ready = TRUE;
        }
    }
    client->clipboard_request_pending = FALSE;
    if (client->clipboard_request_again && client->remote_has_text)
    {
        rc = lazy_clipboard_request(context);
        client->clipboard_request_pending = rc == CHANNEL_RC_OK;
    }
    client->clipboard_request_again = FALSE;
    LeaveCriticalSection(&client->extension_lock);
    return rc;
}

int lazy_freerdp_client_clipboard(LazyFreeRdpClient* client, const uint8_t* data, uint32_t length)
{
    if (!client || !data || length < 2 || length > LAZY_TEXT_LIMIT || length % 2 != 0)
        return 0;
#if !defined(CHANNEL_CLIPRDR_CLIENT)
    lazy_set_error(client, "FreeRDP was built without cliprdr; enable CHANNEL_CLIPRDR and CHANNEL_CLIPRDR_CLIENT and replace the runtime");
    return 0;
#endif
    EnterCriticalSection(&client->extension_lock);
    if (!client->clipboard_ready || !client->clipboard || client->clipboard_announcement_pending || client->paste_ready)
    {
        LeaveCriticalSection(&client->extension_lock);
        lazy_set_error(client, "RDP clipboard is unavailable or a paste is pending");
        return 0;
    }
    BYTE* copy = malloc(length);
    if (!copy)
    {
        LeaveCriticalSection(&client->extension_lock);
        lazy_set_error(client, "failed to allocate RDP clipboard text");
        return 0;
    }
    memcpy(copy, data, length);
    free(client->local_text);
    client->local_text = copy;
    client->local_text_len = length;
    client->paste_pending = TRUE;
    client->paste_failed = FALSE;
    client->paste_started_at = GetTickCount64();
    client->remote_has_text = client->remote_text_ready = FALSE;
    UINT rc = lazy_clipboard_announce(client);
    if (rc != CHANNEL_RC_OK)
        client->paste_pending = FALSE;
    LeaveCriticalSection(&client->extension_lock);
    return rc == CHANNEL_RC_OK;
}

static UINT lazy_send_layout(LazyFreeRdpClient* client)
{
    if (!client->display_ready || !client->display || !client->requested_width)
        return CHANNEL_RC_OK;
    if ((UINT64)client->requested_width * client->requested_height > client->max_monitor_area)
        return CHANNEL_RC_OK;
    DISPLAY_CONTROL_MONITOR_LAYOUT monitor = { 0 };
    monitor.Flags = DISPLAY_CONTROL_MONITOR_PRIMARY;
    monitor.Width = client->requested_width;
    monitor.Height = client->requested_height;
    monitor.DesktopScaleFactor = 100;
    monitor.DeviceScaleFactor = 100;
    return client->display->SendMonitorLayout(client->display, 1, &monitor);
}

static UINT lazy_display_caps(DispClientContext* context, UINT32 monitors, UINT32 a, UINT32 b)
{
    LazyFreeRdpClient* client = context->custom;
    EnterCriticalSection(&client->extension_lock);
    client->display_ready = monitors > 0;
    client->max_monitor_area = (UINT64)a * b;
    UINT rc = lazy_send_layout(client);
    LeaveCriticalSection(&client->extension_lock);
    return rc;
}

int lazy_freerdp_client_resize(LazyFreeRdpClient* client, uint32_t width, uint32_t height)
{
    if (!client || width < 200 || width > 8192 || height < 200 || height > 8192)
        return 0;
    EnterCriticalSection(&client->extension_lock);
    client->requested_width = width & ~1u;
    client->requested_height = height;
    UINT rc = lazy_send_layout(client);
    LeaveCriticalSection(&client->extension_lock);
    return rc == CHANNEL_RC_OK;
}

static void lazy_channel_connected(void* context, const ChannelConnectedEventArgs* event)
{
    if (!event->pInterface)
        return;
    LazyFreeRdpClient* client = lazy_client_from_context(context);
    EnterCriticalSection(&client->extension_lock);
    if (strcmp(event->name, CLIPRDR_SVC_CHANNEL_NAME) == 0)
    {
        CliprdrClientContext* clip = event->pInterface;
        client->clipboard = clip;
        clip->custom = client;
        clip->ServerCapabilities = lazy_clipboard_caps;
        clip->MonitorReady = lazy_clipboard_ready;
        clip->ServerFormatList = lazy_clipboard_list;
        clip->ServerFormatListResponse = lazy_clipboard_ack;
        clip->ServerFormatDataRequest = lazy_clipboard_data_request;
        clip->ServerFormatDataResponse = lazy_clipboard_data_response;
    }
    else if (strcmp(event->name, DISP_DVC_CHANNEL_NAME) == 0)
    {
        client->display = event->pInterface;
        client->display->custom = client;
        client->display->DisplayControlCaps = lazy_display_caps;
    }
    LeaveCriticalSection(&client->extension_lock);
}

static void lazy_channel_disconnected(void* context, const ChannelDisconnectedEventArgs* event)
{
    LazyFreeRdpClient* client = lazy_client_from_context(context);
    EnterCriticalSection(&client->extension_lock);
    if (strcmp(event->name, CLIPRDR_SVC_CHANNEL_NAME) == 0)
    {
        client->clipboard = NULL;
        client->clipboard_ready = client->paste_pending = client->paste_ready = FALSE;
        client->clipboard_announcement_pending = FALSE;
        client->clipboard_request_pending = client->clipboard_request_again = FALSE;
    }
    else if (strcmp(event->name, DISP_DVC_CHANNEL_NAME) == 0)
    {
        client->display = NULL;
        client->display_ready = FALSE;
    }
    LeaveCriticalSection(&client->extension_lock);
}

static BOOL lazy_pointer_new(rdpContext* context, rdpPointer* pointer)
{
    (void)context;
    return pointer->width > 0 && pointer->height > 0 && pointer->width <= 384 && pointer->height <= 384;
}

static void lazy_pointer_free(rdpContext* context, rdpPointer* pointer)
{
    (void)context;
    (void)pointer;
}

static BOOL lazy_pointer_set(rdpContext* context, rdpPointer* pointer)
{
    LazyFreeRdpClient* client = lazy_client_from_context(context);
    if (!lazy_pointer_new(context, pointer))
        return FALSE;
    BYTE* rgba = calloc((size_t)pointer->width * pointer->height, 4);
    if (!rgba)
        return FALSE;
    if (!freerdp_image_copy_from_pointer_data(rgba, PIXEL_FORMAT_RGBA32, pointer->width * 4,
        0, 0, pointer->width, pointer->height, pointer->xorMaskData, pointer->lengthXorMask,
        pointer->andMaskData, pointer->lengthAndMask, pointer->xorBpp, &context->gdi->palette))
    {
        free(rgba);
        return FALSE;
    }
    EnterCriticalSection(&client->extension_lock);
    free(client->cursor_data);
    client->cursor_data = rgba;
    client->cursor_width = pointer->width;
    client->cursor_height = pointer->height;
    client->cursor_x = pointer->xPos;
    client->cursor_y = pointer->yPos;
    client->cursor_kind = 2;
    client->cursor_ready = TRUE;
    LeaveCriticalSection(&client->extension_lock);
    return TRUE;
}

static BOOL lazy_pointer_system(rdpContext* context, UINT32 kind)
{
    LazyFreeRdpClient* client = lazy_client_from_context(context);
    EnterCriticalSection(&client->extension_lock);
    free(client->cursor_data);
    client->cursor_data = NULL;
    client->cursor_width = client->cursor_height = 0;
    client->cursor_kind = kind;
    client->cursor_ready = TRUE;
    LeaveCriticalSection(&client->extension_lock);
    return TRUE;
}

static BOOL lazy_pointer_null(rdpContext* context) { return lazy_pointer_system(context, 4); }
static BOOL lazy_pointer_default(rdpContext* context) { return lazy_pointer_system(context, 5); }
static BOOL lazy_pointer_position(rdpContext* context, UINT32 x, UINT32 y)
{
    (void)context; (void)x; (void)y;
    return TRUE;
}

static void lazy_register_pointer(rdpContext* context)
{
    rdpPointer pointer = { 0 };
    pointer.size = sizeof(rdpPointer);
    pointer.New = lazy_pointer_new;
    pointer.Free = lazy_pointer_free;
    pointer.Set = lazy_pointer_set;
    pointer.SetNull = lazy_pointer_null;
    pointer.SetDefault = lazy_pointer_default;
    pointer.SetPosition = lazy_pointer_position;
    graphics_register_pointer(context->graphics, &pointer);
}

int lazy_freerdp_client_take_event(LazyFreeRdpClient* client, LazyFreeRdpEvent* event)
{
    memset(event, 0, sizeof(*event));
    EnterCriticalSection(&client->extension_lock);
    if (client->paste_pending && GetTickCount64() - client->paste_started_at > 5000)
    {
        client->paste_pending = FALSE;
        client->paste_failed = TRUE;
    }
    if (client->remote_text_ready)
    {
        event->kind = 1;
        event->data = client->remote_text;
        event->length = client->remote_text_len;
        client->remote_text = NULL;
        client->remote_text_ready = FALSE;
    }
    else if (client->cursor_ready)
    {
        event->kind = client->cursor_kind;
        event->width = client->cursor_width;
        event->height = client->cursor_height;
        event->x = client->cursor_x;
        event->y = client->cursor_y;
        event->data = client->cursor_data;
        event->length = client->cursor_width * client->cursor_height * 4;
        client->cursor_data = NULL;
        client->cursor_ready = FALSE;
    }
    else if (client->paste_ready)
    {
        event->kind = 3;
        client->paste_ready = FALSE;
    }
    else if (client->paste_failed)
    {
        event->kind = 6;
        client->paste_failed = FALSE;
    }
    LeaveCriticalSection(&client->extension_lock);
    return event->kind != 0;
}

void lazy_freerdp_event_free(LazyFreeRdpEvent* event) { free(event->data); }

int lazy_freerdp_client_unicode(LazyFreeRdpClient* client, uint16_t code, uint8_t down)
{
    return client && client->connected && freerdp_input_send_unicode_keyboard_event(
        client->context->input, down ? 0 : KBD_FLAGS_RELEASE, code);
}

int lazy_freerdp_client_pause(LazyFreeRdpClient* client)
{
    return client && client->connected && freerdp_input_send_keyboard_pause_event(client->context->input);
}

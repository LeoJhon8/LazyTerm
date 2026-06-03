#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <windows.h>
#endif

#include <freerdp/client.h>
#include <freerdp/codec/color.h>
#include <freerdp/display.h>
#include <freerdp/error.h>
#include <freerdp/freerdp.h>
#include <freerdp/gdi/gdi.h>
#include <freerdp/input.h>
#include <freerdp/settings.h>
#include <freerdp/update.h>
#include <winpr/crt.h>
#include <winpr/synch.h>
#include <winpr/wtypes.h>

#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef ARRAYSIZE
#define ARRAYSIZE(x) (sizeof(x) / sizeof((x)[0]))
#endif

#define LAZY_RDP_POINTER_MOVE 0x0001
#define LAZY_RDP_POINTER_LEFT_DOWN 0x0002
#define LAZY_RDP_POINTER_LEFT_UP 0x0004
#define LAZY_RDP_POINTER_RIGHT_DOWN 0x0008
#define LAZY_RDP_POINTER_RIGHT_UP 0x0010
#define LAZY_RDP_POINTER_MIDDLE_DOWN 0x0020
#define LAZY_RDP_POINTER_MIDDLE_UP 0x0040
#define LAZY_RDP_POINTER_WHEEL 0x0080
#define LAZY_RDP_POINTER_HWHEEL 0x0100

typedef struct LazyFreeRdpClient LazyFreeRdpClient;

void lazy_freerdp_client_free(LazyFreeRdpClient* client);

typedef struct LazyFreeRdpConfig
{
    const char* host;
    uint16_t port;
    const char* username;
    const char* password;
    const char* domain;
    uint32_t width;
    uint32_t height;
} LazyFreeRdpConfig;

typedef struct LazyFreeRdpFrame
{
    uint32_t desktop_width;
    uint32_t desktop_height;
    uint32_t left;
    uint32_t top;
    uint32_t width;
    uint32_t height;
    uint8_t full;
    uint8_t* rgba;
    size_t rgba_len;
} LazyFreeRdpFrame;

typedef struct LazyFreeRdpContext
{
    rdpContext context;
    LazyFreeRdpClient* client;
} LazyFreeRdpContext;

struct LazyFreeRdpClient
{
    rdpContext* context;
    freerdp* instance;
    BOOL started;
    BOOL connected;
    BOOL has_pending_frame;
    LazyFreeRdpFrame pending_frame;
    char last_error[1024];
};

static void lazy_set_error(LazyFreeRdpClient* client, const char* message)
{
    if (!client)
        return;

    if (!message)
        message = "unknown FreeRDP error";

    snprintf(client->last_error, sizeof(client->last_error), "%s", message);
    client->last_error[sizeof(client->last_error) - 1] = '\0';
}

static void lazy_set_last_freerdp_error(LazyFreeRdpClient* client, const char* prefix)
{
    UINT32 code = 0;

    if (client && client->context)
        code = freerdp_get_last_error(client->context);

    snprintf(client->last_error, sizeof(client->last_error), "%s (0x%08" PRIx32 ")", prefix, code);
    client->last_error[sizeof(client->last_error) - 1] = '\0';
}

static LazyFreeRdpClient* lazy_client_from_context(rdpContext* context)
{
    if (!context)
        return NULL;

    return ((LazyFreeRdpContext*)context)->client;
}

static void lazy_clear_frame(LazyFreeRdpFrame* frame)
{
    if (!frame)
        return;

    free(frame->rgba);
    memset(frame, 0, sizeof(*frame));
}

static BOOL lazy_capture_region(LazyFreeRdpClient* client, rdpGdi* gdi, uint32_t left,
                                uint32_t top, uint32_t width, uint32_t height, BOOL full)
{
    uint32_t desktop_width = 0;
    uint32_t desktop_height = 0;
    uint32_t right = 0;
    uint32_t bottom = 0;
    size_t rgba_len = 0;
    uint8_t* rgba = NULL;

    if (!client || !gdi || !gdi->primary_buffer || gdi->width <= 0 || gdi->height <= 0)
        return FALSE;

    desktop_width = (uint32_t)gdi->width;
    desktop_height = (uint32_t)gdi->height;

    if (left >= desktop_width || top >= desktop_height)
        return TRUE;

    if (width > desktop_width - left)
        width = desktop_width - left;
    if (height > desktop_height - top)
        height = desktop_height - top;
    if (width == 0 || height == 0)
        return TRUE;

    right = left + width;
    bottom = top + height;

    if (client->has_pending_frame)
    {
        LazyFreeRdpFrame* pending = &client->pending_frame;
        uint32_t pending_right = pending->left + pending->width;
        uint32_t pending_bottom = pending->top + pending->height;

        if (pending->left < left)
            left = pending->left;
        if (pending->top < top)
            top = pending->top;
        if (pending_right > right)
            right = pending_right;
        if (pending_bottom > bottom)
            bottom = pending_bottom;
        if (pending->full)
            full = TRUE;

        lazy_clear_frame(pending);
        client->has_pending_frame = FALSE;
    }

    if (right > desktop_width)
        right = desktop_width;
    if (bottom > desktop_height)
        bottom = desktop_height;

    width = right - left;
    height = bottom - top;
    rgba_len = (size_t)width * (size_t)height * 4u;
    rgba = (uint8_t*)malloc(rgba_len);
    if (!rgba)
    {
        lazy_set_error(client, "failed to allocate FreeRDP frame buffer");
        return FALSE;
    }

    const uint32_t src_stride = gdi->stride ? gdi->stride : (desktop_width * 4u);
    for (uint32_t y = 0; y < height; y++)
    {
        const uint8_t* src = gdi->primary_buffer + ((top + y) * src_stride) + (left * 4u);
        uint8_t* dst = rgba + ((size_t)y * (size_t)width * 4u);

        for (uint32_t x = 0; x < width; x++)
        {
            const uint8_t b = src[(size_t)x * 4u + 0u];
            const uint8_t g = src[(size_t)x * 4u + 1u];
            const uint8_t r = src[(size_t)x * 4u + 2u];
            const uint8_t a = src[(size_t)x * 4u + 3u];

            dst[(size_t)x * 4u + 0u] = r;
            dst[(size_t)x * 4u + 1u] = g;
            dst[(size_t)x * 4u + 2u] = b;
            dst[(size_t)x * 4u + 3u] = a ? a : 0xFF;
        }
    }

    client->pending_frame.desktop_width = desktop_width;
    client->pending_frame.desktop_height = desktop_height;
    client->pending_frame.left = left;
    client->pending_frame.top = top;
    client->pending_frame.width = width;
    client->pending_frame.height = height;
    client->pending_frame.full = (uint8_t)(full || (left == 0 && top == 0 && width == desktop_width &&
                                                   height == desktop_height));
    client->pending_frame.rgba = rgba;
    client->pending_frame.rgba_len = rgba_len;
    client->has_pending_frame = TRUE;

    return TRUE;
}

static BOOL lazy_begin_paint(rdpContext* context)
{
    rdpGdi* gdi = context ? context->gdi : NULL;
    if (gdi && gdi->primary && gdi->primary->hdc && gdi->primary->hdc->hwnd &&
        gdi->primary->hdc->hwnd->invalid)
    {
        gdi->primary->hdc->hwnd->invalid->null = TRUE;
    }

    return TRUE;
}

static BOOL lazy_end_paint(rdpContext* context)
{
    rdpGdi* gdi = context ? context->gdi : NULL;
    LazyFreeRdpClient* client = lazy_client_from_context(context);

    if (!gdi || !gdi->primary || !gdi->primary->hdc || !gdi->primary->hdc->hwnd)
        return TRUE;

    HGDI_WND hwnd = gdi->primary->hdc->hwnd;
    if (!hwnd->invalid || hwnd->invalid->null)
        return TRUE;

    const int32_t x = hwnd->invalid->x;
    const int32_t y = hwnd->invalid->y;
    const int32_t w = hwnd->invalid->w;
    const int32_t h = hwnd->invalid->h;
    if (x < 0 || y < 0 || w <= 0 || h <= 0)
        return TRUE;

    return lazy_capture_region(client, gdi, (uint32_t)x, (uint32_t)y, (uint32_t)w, (uint32_t)h,
                               FALSE);
}

static BOOL lazy_desktop_resize(rdpContext* context)
{
    rdpGdi* gdi = context ? context->gdi : NULL;
    rdpSettings* settings = context ? context->settings : NULL;
    LazyFreeRdpClient* client = lazy_client_from_context(context);

    if (!gdi || !settings)
        return FALSE;

    const UINT32 width = freerdp_settings_get_uint32(settings, FreeRDP_DesktopWidth);
    const UINT32 height = freerdp_settings_get_uint32(settings, FreeRDP_DesktopHeight);
    if (!gdi_resize(gdi, width, height))
        return FALSE;

    return lazy_capture_region(client, gdi, 0, 0, width, height, TRUE);
}

static BOOL lazy_pre_connect(freerdp* instance)
{
    (void)instance;
    return TRUE;
}

static BOOL lazy_post_connect(freerdp* instance)
{
    if (!instance || !instance->context)
        return FALSE;

    if (!gdi_init(instance, PIXEL_FORMAT_BGRA32))
        return FALSE;

    rdpContext* context = instance->context;
    context->update->BeginPaint = lazy_begin_paint;
    context->update->EndPaint = lazy_end_paint;
    context->update->DesktopResize = lazy_desktop_resize;

    if (context->gdi)
        (void)lazy_capture_region(lazy_client_from_context(context), context->gdi, 0, 0,
                                  (uint32_t)context->gdi->width, (uint32_t)context->gdi->height,
                                  TRUE);

    return TRUE;
}

static void lazy_post_disconnect(freerdp* instance)
{
    if (instance && instance->context && instance->context->gdi)
        gdi_free(instance);
}

static int lazy_logon_error_info(freerdp* instance, UINT32 data, UINT32 type)
{
    (void)data;
    (void)type;
    (void)instance;
    return 1;
}

static BOOL lazy_client_new(freerdp* instance, rdpContext* context)
{
    if (!instance || !context)
        return FALSE;

    instance->PreConnect = lazy_pre_connect;
    instance->PostConnect = lazy_post_connect;
    instance->PostDisconnect = lazy_post_disconnect;
    instance->LogonErrorInfo = lazy_logon_error_info;
    return TRUE;
}

static void lazy_client_free(freerdp* instance, rdpContext* context)
{
    (void)instance;
    (void)context;
}

static int lazy_client_start(rdpContext* context)
{
    (void)context;
    return 0;
}

static int lazy_client_stop(rdpContext* context)
{
    (void)context;
    return 0;
}

static BOOL lazy_apply_settings(LazyFreeRdpClient* client, const LazyFreeRdpConfig* config)
{
    rdpSettings* settings = client && client->context ? client->context->settings : NULL;
    const uint32_t width = config->width ? config->width : 1280u;
    const uint32_t height = config->height ? config->height : 720u;

    if (!settings || !config || !config->host || !config->username || !config->password)
        return FALSE;

    if (!freerdp_settings_set_string(settings, FreeRDP_ServerHostname, config->host))
        return FALSE;
    if (!freerdp_settings_set_uint32(settings, FreeRDP_ServerPort, config->port))
        return FALSE;
    if (!freerdp_settings_set_string(settings, FreeRDP_Username, config->username))
        return FALSE;
    if (!freerdp_settings_set_string(settings, FreeRDP_Password, config->password))
        return FALSE;
    if (config->domain && config->domain[0] != '\0' &&
        !freerdp_settings_set_string(settings, FreeRDP_Domain, config->domain))
        return FALSE;
    if (!freerdp_settings_set_uint32(settings, FreeRDP_DesktopWidth, width))
        return FALSE;
    if (!freerdp_settings_set_uint32(settings, FreeRDP_DesktopHeight, height))
        return FALSE;
    if (!freerdp_settings_set_uint32(settings, FreeRDP_ColorDepth, 32))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_NlaSecurity, TRUE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_IgnoreCertificate, TRUE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_AutoAcceptCertificate, TRUE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_SoftwareGdi, TRUE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_FastPathInput, TRUE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_FastPathOutput, TRUE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_DeviceRedirection, FALSE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_RedirectDrives, FALSE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_RedirectHomeDrive, FALSE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_RedirectSerialPorts, FALSE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_RedirectSmartCards, FALSE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_RedirectPrinters, FALSE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_AudioPlayback, FALSE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_AudioCapture, FALSE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_NetworkAutoDetect, FALSE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_SupportHeartbeatPdu, FALSE))
        return FALSE;
    if (!freerdp_settings_set_bool(settings, FreeRDP_SupportMultitransport, FALSE))
        return FALSE;

    return TRUE;
}

LazyFreeRdpClient* lazy_freerdp_client_new(const LazyFreeRdpConfig* config)
{
    if (!config)
        return NULL;

    LazyFreeRdpClient* client = (LazyFreeRdpClient*)calloc(1, sizeof(LazyFreeRdpClient));
    if (!client)
        return NULL;

    RDP_CLIENT_ENTRY_POINTS entry_points;
    memset(&entry_points, 0, sizeof(entry_points));
    entry_points.Version = RDP_CLIENT_INTERFACE_VERSION;
#ifdef RDP_CLIENT_ENTRY_POINTS_V1
    entry_points.Size = sizeof(RDP_CLIENT_ENTRY_POINTS_V1);
#else
    entry_points.Size = sizeof(RDP_CLIENT_ENTRY_POINTS);
#endif
    entry_points.ContextSize = sizeof(LazyFreeRdpContext);
    entry_points.ClientNew = lazy_client_new;
    entry_points.ClientFree = lazy_client_free;
    entry_points.ClientStart = lazy_client_start;
    entry_points.ClientStop = lazy_client_stop;

    client->context = freerdp_client_context_new(&entry_points);
    if (!client->context)
    {
        lazy_set_error(client, "failed to create FreeRDP client context");
        free(client);
        return NULL;
    }

    ((LazyFreeRdpContext*)client->context)->client = client;
    client->instance = client->context->instance;

    if (!lazy_apply_settings(client, config))
    {
        lazy_set_error(client, "failed to configure FreeRDP settings");
        lazy_freerdp_client_free(client);
        return NULL;
    }

    return client;
}

int lazy_freerdp_client_connect(LazyFreeRdpClient* client)
{
    if (!client || !client->context || !client->instance)
        return 0;

    if (client->connected)
        return 1;

    if (freerdp_client_start(client->context) != 0)
    {
        lazy_set_error(client, "failed to start FreeRDP client context");
        return 0;
    }
    client->started = TRUE;

    if (!freerdp_connect(client->instance))
    {
        lazy_set_last_freerdp_error(client, "FreeRDP connect failed");
        (void)freerdp_client_stop(client->context);
        client->started = FALSE;
        return 0;
    }

    client->connected = TRUE;
    return 1;
}

int lazy_freerdp_client_poll(LazyFreeRdpClient* client, uint32_t timeout_ms, LazyFreeRdpFrame* frame)
{
    HANDLE handles[MAXIMUM_WAIT_OBJECTS] = { 0 };
    DWORD count = 0;
    DWORD status = 0;

    if (!client || !client->context || !frame)
        return -1;

    memset(frame, 0, sizeof(*frame));

    if (client->has_pending_frame)
    {
        *frame = client->pending_frame;
        memset(&client->pending_frame, 0, sizeof(client->pending_frame));
        client->has_pending_frame = FALSE;
        return 1;
    }

    if (!client->connected || freerdp_shall_disconnect_context(client->context))
    {
        lazy_set_error(client, "FreeRDP session disconnected");
        return -1;
    }

    count = freerdp_get_event_handles(client->context, handles, ARRAYSIZE(handles));
    if (count == 0)
    {
        lazy_set_error(client, "freerdp_get_event_handles failed");
        return -1;
    }

    status = WaitForMultipleObjects(count, handles, FALSE, timeout_ms);
    if (status == WAIT_TIMEOUT)
        return 0;
    if (status == WAIT_FAILED)
    {
        lazy_set_error(client, "WaitForMultipleObjects failed");
        return -1;
    }

    if (!freerdp_check_event_handles(client->context))
    {
        lazy_set_last_freerdp_error(client, "freerdp_check_event_handles failed");
        return -1;
    }

    if (client->has_pending_frame)
    {
        *frame = client->pending_frame;
        memset(&client->pending_frame, 0, sizeof(client->pending_frame));
        client->has_pending_frame = FALSE;
        return 1;
    }

    return 0;
}

void lazy_freerdp_frame_free(LazyFreeRdpFrame* frame)
{
    lazy_clear_frame(frame);
}

static BOOL lazy_send_mouse_flags(LazyFreeRdpClient* client, UINT16 x, UINT16 y, UINT16 flags)
{
    if (!client || !client->context || !client->context->input)
        return FALSE;

    return freerdp_input_send_mouse_event(client->context->input, flags, x, y);
}

int lazy_freerdp_client_send_pointer(LazyFreeRdpClient* client, uint16_t x, uint16_t y,
                                     uint16_t flags, int16_t wheel_delta)
{
    UINT16 pointer_flags = 0;

    if (!client || !client->connected)
        return 0;

    if (flags & LAZY_RDP_POINTER_MOVE)
        pointer_flags |= PTR_FLAGS_MOVE;
    if (flags & LAZY_RDP_POINTER_LEFT_DOWN)
        pointer_flags |= PTR_FLAGS_DOWN | PTR_FLAGS_BUTTON1;
    if (flags & LAZY_RDP_POINTER_LEFT_UP)
        pointer_flags |= PTR_FLAGS_BUTTON1;
    if (flags & LAZY_RDP_POINTER_RIGHT_DOWN)
        pointer_flags |= PTR_FLAGS_DOWN | PTR_FLAGS_BUTTON2;
    if (flags & LAZY_RDP_POINTER_RIGHT_UP)
        pointer_flags |= PTR_FLAGS_BUTTON2;
    if (flags & LAZY_RDP_POINTER_MIDDLE_DOWN)
        pointer_flags |= PTR_FLAGS_DOWN | PTR_FLAGS_BUTTON3;
    if (flags & LAZY_RDP_POINTER_MIDDLE_UP)
        pointer_flags |= PTR_FLAGS_BUTTON3;

    if (flags & (LAZY_RDP_POINTER_WHEEL | LAZY_RDP_POINTER_HWHEEL))
    {
        const int16_t signed_delta = wheel_delta == 0 ? 120 : wheel_delta;
        UINT16 rotation = (UINT16)(abs(signed_delta) & WheelRotationMask);
        if (rotation == 0)
            rotation = 120;

        pointer_flags |= (flags & LAZY_RDP_POINTER_HWHEEL) ? PTR_FLAGS_HWHEEL : PTR_FLAGS_WHEEL;
        if (signed_delta < 0)
            pointer_flags |= PTR_FLAGS_WHEEL_NEGATIVE;
        pointer_flags |= rotation;
    }

    if (pointer_flags == 0)
        pointer_flags = PTR_FLAGS_MOVE;

    if (!lazy_send_mouse_flags(client, x, y, pointer_flags))
    {
        lazy_set_error(client, "failed to send FreeRDP pointer event");
        return 0;
    }

    return 1;
}

int lazy_freerdp_client_send_key(LazyFreeRdpClient* client, uint32_t scancode, uint8_t down)
{
    if (!client || !client->connected || !client->context || !client->context->input)
        return 0;

    if (!freerdp_input_send_keyboard_event_ex(client->context->input, down ? TRUE : FALSE, FALSE,
                                             scancode))
    {
        lazy_set_error(client, "failed to send FreeRDP keyboard event");
        return 0;
    }

    return 1;
}

int lazy_freerdp_client_resize(LazyFreeRdpClient* client, uint32_t width, uint32_t height)
{
    if (!client || !client->connected || !client->context || !client->context->settings)
        return 0;

    if (width == 0 || height == 0)
        return 0;

    if (!freerdp_settings_set_uint32(client->context->settings, FreeRDP_DesktopWidth, width))
        return 0;
    if (!freerdp_settings_set_uint32(client->context->settings, FreeRDP_DesktopHeight, height))
        return 0;

    MONITOR_DEF monitor;
    memset(&monitor, 0, sizeof(monitor));
    monitor.left = 0;
    monitor.top = 0;
    monitor.right = (INT32)width - 1;
    monitor.bottom = (INT32)height - 1;
    monitor.flags = MONITOR_PRIMARY;

    if (!freerdp_display_send_monitor_layout(client->context, 1, &monitor))
    {
        lazy_set_error(client, "failed to send FreeRDP monitor layout update");
        return 0;
    }

    return 1;
}

void lazy_freerdp_client_close(LazyFreeRdpClient* client)
{
    if (!client)
        return;

    if (client->connected && client->instance)
    {
        freerdp_disconnect(client->instance);
        client->connected = FALSE;
    }
}

void lazy_freerdp_client_free(LazyFreeRdpClient* client)
{
    if (!client)
        return;

    lazy_freerdp_client_close(client);

    if (client->started && client->context)
    {
        (void)freerdp_client_stop(client->context);
        client->started = FALSE;
    }

    if (client->context)
    {
        freerdp_client_context_free(client->context);
        client->context = NULL;
        client->instance = NULL;
    }

    lazy_clear_frame(&client->pending_frame);
    free(client);
}

const char* lazy_freerdp_client_last_error(LazyFreeRdpClient* client)
{
    if (!client || client->last_error[0] == '\0')
        return NULL;

    return client->last_error;
}

const char* lazy_freerdp_version(void)
{
    return freerdp_get_version_string();
}

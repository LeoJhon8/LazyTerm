/**
 * LibVNCClient C 包装器
 * 
 * 这个文件提供对 libvncclient 结构体字段的访问器函数，
 * 因为 Rust FFI 不能直接访问 C 结构体字段。
 * 
 * 编译命令（在构建脚本中使用）：
 *   gcc -c wrapper.c -o wrapper.o `pkg-config --cflags libvncclient`
 */
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#ifdef _MSC_VER
#define strdup _strdup
#endif
#endif

#include <rfb/rfbclient.h>
#include <rfb/rfbproto.h>
#include <stdarg.h>
#include <stdlib.h>
#include <string.h>

static rfbBool HandleIgnoredQemuMessage(rfbClient* client, rfbServerToClientMsg* message) {
    if (!client || !message || message->type != rfbQemuEvent) {
        return FALSE;
    }

    char payload[sz_rfbQemuExtendedKeyEventMsg - 1] = {0};
    if (!ReadFromRFBServer(client, payload, sizeof(payload))) {
        return FALSE;
    }

    return TRUE;
}

void RfbClientRegisterIgnoreQemuExtension() {
    static rfbClientProtocolExtension extension = {0};
    static rfbBool registered = FALSE;

    if (registered) {
        return;
    }

    extension.encodings = NULL;
    extension.handleEncoding = NULL;
    extension.handleMessage = HandleIgnoredQemuMessage;
    extension.next = NULL;
    extension.securityTypes = NULL;
    extension.handleAuthentication = NULL;

    rfbClientRegisterExtension(&extension);
    registered = TRUE;
}

// ============================================================================
// 字段访问器
// ============================================================================

int RfbClientGetScreenWidth(rfbClient* client) {
    return client ? client->width : 0;
}

int RfbClientGetScreenHeight(rfbClient* client) {
    return client ? client->height : 0;
}

uint8_t* RfbClientGetFrameBuffer(rfbClient* client) {
    return client ? client->frameBuffer : NULL;
}

const uint8_t* RfbClientGetCursorSource(rfbClient* client) {
    return client ? client->rcSource : NULL;
}

const uint8_t* RfbClientGetCursorMask(rfbClient* client) {
    return client ? client->rcMask : NULL;
}

rfbBool RfbClientSupportsDesktopResize(rfbClient* client) {
    return client && client->screen.width > 0 && client->screen.height > 0;
}

rfbPixelFormat RfbClientGetPixelFormat(rfbClient* client) {
    rfbPixelFormat fmt = {0};
    if (client) {
        memcpy(&fmt, &client->format, sizeof(rfbPixelFormat));
    }
    return fmt;
}

const char* RfbClientGetDesktopName(rfbClient* client) {
    return client ? client->desktopName : NULL;
}

void RfbClientSetEncodingsString(rfbClient* client, const char* encodings) {
    if (!client) {
        return;
    }

    // LibVNCClient treats this field as borrowed storage. Rust keeps the CString
    // alive in the per-session context until rfbClientCleanup has completed.
    client->appData.encodingsString = (char*)encodings;
}

char* RfbClientDupCString(const char* value) {
    if (!value) {
        return NULL;
    }

    return strdup(value);
}

void RfbClientSetEnableJpeg(rfbClient* client, rfbBool enable) {
    if (client) {
        client->appData.enableJPEG = enable;
    }
}

void RfbClientSetUseRemoteCursor(rfbClient* client, rfbBool enable) {
    if (client) {
        client->appData.useRemoteCursor = enable;
    }
}

void RfbClientSetHandleNewFBSize(rfbClient* client, rfbBool enable) {
    if (client) {
        client->canHandleNewFBSize = enable;
    }
}

void RfbClientSetConnectTimeout(rfbClient* client, unsigned int timeout_seconds) {
    if (client) {
        client->connectTimeout = timeout_seconds;
    }
}

void RfbClientSetReadTimeout(rfbClient* client, unsigned int timeout_seconds) {
    if (client) {
        client->readTimeout = timeout_seconds;
    }
}

void RfbClientSetCompressLevel(rfbClient* client, int level) {
    if (client) {
        client->appData.compressLevel = level;
    }
}

void RfbClientSetQualityLevel(rfbClient* client, int level) {
    if (client) {
        client->appData.qualityLevel = level;
    }
}

// ============================================================================
// 回调设置器
// ============================================================================

void RfbClientSetMallocFrameBuffer(rfbClient* client, MallocFrameBufferProc callback) {
    if (client) {
        // LibVNCClient 的 MallocFrameBuffer 类型与 FrameBufferUpdate 不同
        // 但我们使用相同的签名简化处理
        client->MallocFrameBuffer = callback;
    }
}

void RfbClientSetGotFrameBufferUpdate(rfbClient* client, GotFrameBufferUpdateProc callback) {
    if (client) {
        client->GotFrameBufferUpdate = callback;
    }
}

void RfbClientSetHandleCursorShape(rfbClient* client, GotCursorShapeProc callback) {
    if (client) {
        client->GotCursorShape = callback;
    }
}

void RfbClientSetGotXCutText(rfbClient* client, GotXCutTextProc callback) {
    if (client) {
        client->GotXCutText = callback;
    }
}

void RfbClientSetGotCursorPos(rfbClient* client, HandleCursorPosProc callback) {
    if (client) {
        client->HandleCursorPos = callback;
    }
}

void RfbClientSetGetPassword(rfbClient* client, GetPasswordProc callback) {
    if (client) {
        client->GetPassword = callback;
    }
}

// ============================================================================
// 配置设置器
// ============================================================================

void RfbClientSetServerHost(rfbClient* client, const char* host) {
    if (client && host) {
        free(client->serverHost);
        client->serverHost = strdup(host);
    }
}

void RfbClientSetServerPort(rfbClient* client, int port) {
    if (client) {
        client->serverPort = port;
    }
}

void RfbClientSetPassword(rfbClient* client, const char* password) {
    (void)client;
    (void)password;
    /*
     * 当前 libvncclient 通过 GetPassword 回调提供密码，而不是暴露
     * rfbClient.password 字段。该包装器暂未被 Rust 侧调用，因此保留为 no-op，
     * 避免和不同版本头文件的内部结构耦合。
     */
}

void RfbClientSetShared(rfbClient* client, rfbBool shared) {
    if (client) {
        client->appData.shareDesktop = shared;
    }
}

void RfbClientSetViewOnly(rfbClient* client, rfbBool viewOnly) {
    if (client) {
        client->appData.viewOnly = viewOnly;
    }
}

// ============================================================================
// 编码管理
// ============================================================================

void RfbClientClearEncodings(rfbClient* client) {
    if (client) {
        client->appData.encodingsString = NULL;
    }
}

void RfbClientAddEncoding(rfbClient* client, int encoding) {
    (void)client;
    (void)encoding;
    /*
     * 新版 libvncclient 不再通过 rfbClient 内部公开的 supportedEncodings/nEncodings
     * 字段来配置编码。当前 Rust 侧已经通过 rfbInitClient 的命令行参数设置编码，
     * 这里保留 no-op 兼容实现。
     */
}

// ============================================================================
// 像素格式设置
// ============================================================================

void RfbClientSetPixelFormat(rfbClient* client, int bits_per_pixel, int depth,
                             int big_endian, int true_colour,
                             int red_max, int green_max, int blue_max,
                             int red_shift, int green_shift, int blue_shift) {
    if (!client) return;
    
    client->format.bitsPerPixel = bits_per_pixel;
    client->format.depth = depth;
    client->format.bigEndian = big_endian;
    client->format.trueColour = true_colour;
    client->format.redMax = red_max;
    client->format.greenMax = green_max;
    client->format.blueMax = blue_max;
    client->format.redShift = red_shift;
    client->format.greenShift = green_shift;
    client->format.blueShift = blue_shift;
}

// ============================================================================
// 错误处理
// ============================================================================

#if defined(_MSC_VER)
#define RFB_THREAD_LOCAL __declspec(thread)
#else
#define RFB_THREAD_LOCAL _Thread_local
#endif

static RFB_THREAD_LOCAL char lastError[1024] = {0};

static void RfbClientCaptureLog(const char* format, ...) {
    if (!format) {
        return;
    }

    va_list args;
    va_start(args, format);
    vsnprintf(lastError, sizeof(lastError), format, args);
    va_end(args);

    lastError[sizeof(lastError) - 1] = '\0';
}

void RfbClientInstallLogCapture() {
    rfbClientLog = RfbClientCaptureLog;
    rfbClientErr = RfbClientCaptureLog;
    rfbEnableClientLogging = TRUE;
}

void RfbClientSetLastError(rfbClient* client, const char* error) {
    (void)client; // 暂不使用 client 特定的错误存储
    if (error) {
        strncpy(lastError, error, sizeof(lastError) - 1);
        lastError[sizeof(lastError) - 1] = '\0';
    } else {
        lastError[0] = '\0';
    }
}

const char* RfbClientGetLastError(rfbClient* client) {
    (void)client;
    return lastError[0] ? lastError : NULL;
}

// ============================================================================
// 工具函数
// ============================================================================

rfbBool RfbClientDefaultMallocFrameBuffer(rfbClient* client) {
    if (!client) return FALSE;
    
    uint64_t memSize = (uint64_t)client->width * client->height * (client->format.bitsPerPixel / 8);
    
    // 安全检查：限制最大内存分配
    if (memSize > 100 * 1024 * 1024) { // 100MB 限制
        return FALSE;
    }
    
    if (client->frameBuffer) {
        free(client->frameBuffer);
    }
    
    client->frameBuffer = malloc(memSize);
    return client->frameBuffer != NULL;
}

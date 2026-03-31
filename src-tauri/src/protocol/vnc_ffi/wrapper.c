/**
 * LibVNCClient C 包装器
 * 
 * 这个文件提供对 libvncclient 结构体字段的访问器函数，
 * 因为 Rust FFI 不能直接访问 C 结构体字段。
 * 
 * 编译命令（在构建脚本中使用）：
 *   gcc -c wrapper.c -o wrapper.o `pkg-config --cflags libvncclient`
 */

#include <rfb/rfbclient.h>
#include <string.h>

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

void RfbClientSetHandleCursorShape(rfbClient* client, HandleCursorShapeProc callback) {
    if (client) {
        client->HandleCursorShape = callback;
    }
}

void RfbClientSetGotXCutText(rfbClient* client, GotXCutTextProc callback) {
    if (client) {
        client->GotXCutText = callback;
    }
}

void RfbClientSetGotCursorPos(rfbClient* client, GotCursorPosProc callback) {
    if (client) {
        client->GotCursorPos = callback;
    }
}

// ============================================================================
// 配置设置器
// ============================================================================

void RfbClientSetServerHost(rfbClient* client, const char* host) {
    if (client && host) {
        strncpy(client->serverHost, host, MAX_HOST_NAME_LEN - 1);
        client->serverHost[MAX_HOST_NAME_LEN - 1] = '\0';
    }
}

void RfbClientSetServerPort(rfbClient* client, int port) {
    if (client) {
        client->serverPort = port;
    }
}

void RfbClientSetPassword(rfbClient* client, const char* password) {
    if (client && password) {
        client->password = strdup(password);
    }
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
    if (!client) return;
    
    // 自动扩展编码数组
    int32_t* newEncodings = realloc(client->supportedEncodings, 
                                    (client->nEncodings + 1) * sizeof(int32_t));
    if (newEncodings) {
        client->supportedEncodings = newEncodings;
        client->supportedEncodings[client->nEncodings++] = encoding;
    }
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

static char lastError[1024] = {0};

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

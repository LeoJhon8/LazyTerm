//! VNC 实现功能开关
//!
//! 本模块提供条件编译支持，允许在 LibVNCClient 和 vnc-rs 实现之间切换。

/// 当前使用的 VNC 后端类型
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum VncBackend {
    /// LibVNCClient C 库（推荐）
    LibVncClient,
    /// 纯 Rust vnc-rs 实现（回退）
    VncRs,
}

impl VncBackend {
    /// 获取当前启用的后端
    pub fn current() -> Self {
        #[cfg(feature = "vnc-libvncclient")]
        return VncBackend::LibVncClient;
        
        #[cfg(not(feature = "vnc-libvncclient"))]
        return VncBackend::VncRs;
    }
    
    /// 检查是否为 LibVNCClient
    pub fn is_libvncclient(&self) -> bool {
        matches!(self, VncBackend::LibVncClient)
    }
    
    /// 检查是否为 vnc-rs
    pub fn is_vnc_rs(&self) -> bool {
        matches!(self, VncBackend::VncRs)
    }
}

impl std::fmt::Display for VncBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VncBackend::LibVncClient => write!(f, "LibVNCClient"),
            VncBackend::VncRs => write!(f, "vnc-rs"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_backend_detection() {
        let backend = VncBackend::current();
        
        // 根据编译特性断言
        #[cfg(feature = "vnc-libvncclient")]
        assert!(backend.is_libvncclient());
        
        #[cfg(not(feature = "vnc-libvncclient"))]
        assert!(backend.is_vnc_rs());
    }
}

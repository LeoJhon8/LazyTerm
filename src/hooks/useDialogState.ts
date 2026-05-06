import { useState, useCallback } from "react";

/**
 * 支持的弹窗类型
 */
export type DialogType = 
  | "ssh" 
  | "directSsh" 
  | "rdp" 
  | "directRdp" 
  | "vnc" 
  | "directVnc" 
  | "serial"
  | "directSerial"
  | "telnet"
  | "directTelnet"
  | "ai-cli"
  | "directAiCli"
  | "folder" 
  | "delete" 
  | "edit" 
  | "sftp";

/**
 * 弹窗状态
 */
export interface DialogState {
  /** 当前打开的弹窗类型 */
  openDialog: DialogType | null;
  /** 弹窗关联的目标节点 ID */
  targetNodeId: string | null;
  /** 编辑弹窗的初始值 */
  editValue: string;
}

/**
 * 管理多个弹窗状态的 Hook
 * 替代多个独立的 useState 管理弹窗开关
 * 
 * @example
 * ```tsx
 * const { open, close, isOpen, targetNodeId, editValue, setEditValue } = useDialogState();
 * 
 * // 打开弹窗
 * open("ssh", nodeId);
 * 
 * // 关闭弹窗
 * close();
 * 
 * // 检查弹窗是否打开
 * if (isOpen("ssh")) { ... }
 * ```
 */
export function useDialogState() {
  const [state, setState] = useState<DialogState>({
    openDialog: null,
    targetNodeId: null,
    editValue: "",
  });

  /**
   * 打开指定类型的弹窗
   */
  const open = useCallback((type: DialogType, nodeId: string | null = null, initialValue: string = "") => {
    setState({
      openDialog: type,
      targetNodeId: nodeId,
      editValue: initialValue,
    });
  }, []);

  /**
   * 关闭当前弹窗
   */
  const close = useCallback(() => {
    setState({
      openDialog: null,
      targetNodeId: null,
      editValue: "",
    });
  }, []);

  /**
   * 检查指定类型的弹窗是否打开
   */
  const isOpen = useCallback((type: DialogType) => {
    return state.openDialog === type;
  }, [state.openDialog]);

  /**
   * 设置编辑值
   */
  const setEditValue = useCallback((value: string) => {
    setState((prev) => ({ ...prev, editValue: value }));
  }, []);

  /**
   * 切换弹窗开关状态
   */
  const toggle = useCallback((type: DialogType, nodeId: string | null = null) => {
    setState((prev) => ({
      openDialog: prev.openDialog === type ? null : type,
      targetNodeId: prev.openDialog === type ? null : nodeId,
      editValue: "",
    }));
  }, []);

  return {
    // 状态
    openDialog: state.openDialog,
    targetNodeId: state.targetNodeId,
    editValue: state.editValue,
    
    // 操作方法
    open,
    close,
    isOpen,
    setEditValue,
    toggle,
  };
}

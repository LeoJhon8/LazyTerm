import React, { useState, useMemo, useEffect } from "react";
import { 
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay, 
  useDraggable, useDroppable
} from "@dnd-kit/core";
import { 
  Folder, Server, ChevronRight, ChevronDown, Plus, FolderPlus, 
  Pencil, Trash2, Terminal
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSshProfilesStore, type SessionNode } from "@/store/ssh-profiles";
import { useTabsStore } from "@/store/tabs";
import { SshConnectDialog } from "@/components/dialogs/SshConnectDialog";
import { 
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSeparator 
} from "@/components/ui/context-menu";
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel 
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Terminal as TerminalIcon, ShieldAlert, MonitorCheck, PlusCircle } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface AvailableShell {
  name: string;
  path: string;
  icon_type: string;
}

function getSortedFlattenedNodes(nodes: SessionNode[], parentId: string | null = null, depth = 0): (SessionNode & { depth: number })[] {
  return nodes
    .filter(n => n.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .reduce((acc, node) => {
      acc.push({ ...node, depth });
      if (node.type === 'folder' && node.isExpanded) {
        acc.push(...getSortedFlattenedNodes(nodes, node.id, depth + 1));
      }
      return acc;
    }, [] as any[]);
}

function NodeRowContent({ 
  node, depth, isDragging, isOver, dropPos, isOverlay 
}: { 
  node: SessionNode, depth: number, isDragging?: boolean, isOver?: boolean, dropPos?: any, isOverlay?: boolean 
}) {
  const isFolder = node.type === "folder";
  return (
    <div
      style={{ paddingLeft: `${isOverlay ? 8 : depth * 14 + 6}px` }}
      className={cn(
        "flex items-center gap-2 py-1.5 px-2 rounded-sm text-sm transition-all relative border-y border-transparent",
        !isOverlay && "group hover:bg-accent/40",
        isOverlay && "bg-background border shadow-xl opacity-90 w-[240px] z-50 pointer-events-none",
        
        // 放置指示器
        isOver && !isDragging && dropPos === 'before' && [
          "before:content-[''] before:absolute before:top-[-1px] before:left-0 before:right-0 before:h-[2px] before:bg-primary before:z-[100]"
        ],
        isOver && !isDragging && dropPos === 'after' && [
          "after:content-[''] after:absolute after:bottom-[-1px] after:left-0 after:right-0 after:h-[2px] after:bg-primary after:z-[100]"
        ],
        isOver && !isDragging && dropPos === 'inside' && "bg-primary/20 ring-1 ring-primary/30 ring-inset"
      )}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {isFolder ? (
          <div className="flex items-center gap-1 text-muted-foreground/60">
            {node.isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Folder className={cn("h-4 w-4", node.isRoot ? "text-amber-500 fill-amber-500/10" : "text-blue-500 fill-blue-500/10")} />
          </div>
        ) : (
          <Server className="h-4 w-4 text-emerald-600/80" />
        )}
        <span className={cn("truncate flex-1 select-none", node.isRoot ? "font-bold text-foreground" : "font-medium text-muted-foreground group-hover:text-foreground")}>
          {node.name}
        </span>
      </div>
    </div>
  );
}

function DraggableDroppableRow({ node, depth, onAction, activeId }: { node: SessionNode, depth: number, onAction: any, activeId: string | null }) {
  const { toggleFolder } = useSshProfilesStore();
  const [localDropPos, setLocalDropPos] = useState<'before' | 'after' | 'inside' | null>(null);

  const { attributes, listeners, setNodeRef: setDraggableRef, isDragging } = useDraggable({ 
    id: node.id, 
    disabled: node.isRoot 
  });
  
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({ 
    id: node.id,
    data: { dropPos: localDropPos } 
  });

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!activeId || isDragging) return;
    
    // 如果是根节点，只允许 "inside"
    if (node.isRoot) {
      setLocalDropPos('inside');
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    
    if (node.type === 'folder') {
      if (relativeY < rect.height * 0.25) setLocalDropPos('before');
      else if (relativeY > rect.height * 0.75) setLocalDropPos('after');
      else setLocalDropPos('inside');
    } else {
      if (relativeY < rect.height * 0.5) setLocalDropPos('before');
      else setLocalDropPos('after');
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div 
          ref={setDroppableRef} 
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setLocalDropPos(null)}
          onClick={() => node.type === 'folder' ? toggleFolder(node.id) : onAction('connect', node)}
        >
          <div ref={setDraggableRef} {...attributes} {...listeners} className={cn(isDragging && "opacity-20")}>
            <NodeRowContent 
              node={node} 
              depth={depth} 
              isDragging={isDragging} 
              isOver={isOver} 
              dropPos={localDropPos} 
            />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {node.type === 'folder' ? (
          <>
            <ContextMenuItem onClick={() => onAction('new-ssh', node)}><Plus className="mr-2 h-4 w-4" /> 新建连接</ContextMenuItem>
            <ContextMenuItem onClick={() => onAction('new-folder', node)}><FolderPlus className="mr-2 h-4 w-4" /> 新建子文件夹</ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem onClick={() => onAction('connect', node)}><Terminal className="mr-2 h-4 w-4" /> 连接会话</ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => onAction('edit', node)}><Pencil className="mr-2 h-4 w-4" />编辑</ContextMenuItem>
        {!node.isRoot && <ContextMenuItem onClick={() => onAction('delete', node)} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" /> 删除</ContextMenuItem>}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function SessionModule() {
  const { nodes, addFolder, addProfile, removeNode, updateNode, moveNode, ensureRoot } = useSshProfilesStore();
  const { addSession } = useTabsStore();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [sshOpen, setSshOpen] = useState(false);
  const [directSshOpen, setDirectSshOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [targetNode, setTargetNode] = useState<SessionNode | null>(null);
  const [editNode, setEditNode] = useState<SessionNode | null>(null);
  const [tempName, setTempName] = useState("");
  const [availableShells, setAvailableShells] = useState<AvailableShell[]>([]);

  useEffect(() => { 
    ensureRoot(); 
    // 获取系统可用 Shell
    invoke<AvailableShell[]>("get_available_shells")
      .then(setAvailableShells)
      .catch(err => console.error("获取可用 Shell 失败:", err));
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const sortedNodes = useMemo(() => getSortedFlattenedNodes(nodes), [nodes]);

  const handleAction = (type: string, node: SessionNode) => {
    if (type === 'connect' && node.config) {
      addSession({ title: node.name, type: "ssh", host: node.config.host, config: { host: node.config.host, port: node.config.port, sshConfig: node.config } });
    } else if (type === 'new-ssh') { setTargetNode(node); setEditNode(null); setSshOpen(true); }
    else if (type === 'new-folder') { setTargetNode(node); setEditNode(null); setFolderOpen(true); }
    else if (type === 'edit') { 
      setEditNode(node); 
      if (node.type === 'folder') { setTempName(node.name); setFolderOpen(true); } 
      else setSshOpen(true);
    } else if (type === 'delete') { setTargetNode(node); setDeleteOpen(true); }
  };

  const handleDirectConnect = (name: string, path: string, admin = false) => {
    const title = `${name}${admin ? ' (Admin)' : ''}`;
    
    addSession({
      title,
      type: "local",
      config: { 
        shell: path,
        admin,
      }
    });
  };

  const getShellIcon = (type: string) => {
    switch (type) {
      case 'powershell': return <MonitorCheck className="mr-2 h-4 w-4 text-blue-500" />;
      case 'cmd': return <TerminalIcon className="mr-2 h-4 w-4 text-muted-foreground" />;
      case 'bash': return <TerminalIcon className="mr-2 h-4 w-4 text-orange-500" />;
      default: return <TerminalIcon className="mr-2 h-4 w-4" />;
    }
  };

  return (
    <div className="h-full flex flex-col bg-background/50 border-r">
      <div className="h-[var(--th)] px-3 border-b bg-muted/20 flex items-center justify-between group">
        <h3 className="text-xs font-bold uppercase text-muted-foreground tracking-widest select-none">会话</h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              className={cn(
                "h-7 w-7 transition-all duration-200",
                "bg-accent/50 hover:bg-accent text-accent-foreground shadow-sm",
                "opacity-80 group-hover:opacity-100"
              )}
            >
              <PlusCircle className="h-4.5 w-4.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-56 overflow-hidden">
            <DropdownMenuLabel className="text-[10px] font-bold text-muted-foreground uppercase py-2 bg-muted/30">快速连接 (不保存)</DropdownMenuLabel>
            
            {availableShells.map((shell) => (
              <React.Fragment key={shell.path}>
                <DropdownMenuItem onClick={() => handleDirectConnect(shell.name, shell.path)}>
                  {getShellIcon(shell.icon_type)}
                  {shell.name}
                </DropdownMenuItem>
                {/* Windows 下所有本地 Shell (CMD, PS, Bash) 都显示管理员选项 */}
                <DropdownMenuItem onClick={() => handleDirectConnect(shell.name, shell.path, true)}>
                  <ShieldAlert className="mr-2 h-4 w-4 text-amber-500" />
                  {shell.name} 管理员
                </DropdownMenuItem>
              </React.Fragment>
            ))}

            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setDirectSshOpen(true)}>
              <Server className="mr-2 h-4 w-4 text-emerald-500" /> SSH 连接
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      
      <div className="flex-1 overflow-y-auto py-2 px-1">
        <DndContext 
          sensors={sensors} 
          collisionDetection={closestCenter} 
          onDragStart={(e) => setActiveId(e.active.id as string)}
          onDragEnd={(e) => {
            const { active, over } = e;
            if (over && active.id !== over.id) {
              const dropPos = over.data.current?.dropPos;
              if (dropPos) moveNode(active.id as string, over.id as string, dropPos);
            }
            setActiveId(null);
          }}
        >
          <div className="flex flex-col">
            {sortedNodes.map((fn) => (
              <DraggableDroppableRow key={fn.id} node={fn} depth={fn.depth} onAction={handleAction} activeId={activeId} />
            ))}
          </div>

          <DragOverlay dropAnimation={null} style={{ pointerEvents: 'none' }}>
            {activeId ? (
              <NodeRowContent isOverlay node={nodes.find(n => n.id === activeId)!} depth={0} />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editNode ? "重命名" : "新建文件夹"}</DialogTitle></DialogHeader>
          <Input 
            value={tempName} 
            onChange={(e) => setTempName(e.target.value)} 
            placeholder="请输入名称" 
            autoFocus 
            onKeyDown={e => e.key === 'Enter' && (editNode ? updateNode(editNode.id, { name: tempName }) : targetNode && addFolder(tempName, targetNode.id), setFolderOpen(false), setTempName(""))}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFolderOpen(false)}>取消</Button>
            <Button onClick={() => {
              if (editNode) updateNode(editNode.id, { name: tempName });
              else if (targetNode) addFolder(tempName, targetNode.id);
              setFolderOpen(false); setTempName("");
            }}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SshConnectDialog open={sshOpen} onOpenChange={setSshOpen} initialConfig={editNode?.config} onSave={(cfg) => {
        if (editNode) updateNode(editNode.id, { config: cfg, name: cfg.nickname || cfg.host });
        else if (targetNode) addProfile(cfg, targetNode.id);
        setSshOpen(false);
      }} />
      <SshConnectDialog open={directSshOpen} onOpenChange={setDirectSshOpen} isDirect={true} onSave={(cfg) => {
        addSession({ 
          title: cfg.nickname || cfg.host, 
          type: "ssh", 
          host: cfg.host, 
          config: { host: cfg.host, port: cfg.port, sshConfig: cfg } 
        });
        setDirectSshOpen(false);
      }} />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>确认删除 "{targetNode?.name}"？</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-destructive" onClick={() => targetNode && removeNode(targetNode.id)}>删除</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
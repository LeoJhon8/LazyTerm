import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, FolderPlus, Server, Terminal, GripVertical, Pencil, Trash2 } from "lucide-react";
import { useTabsStore } from "@/store/tabs";
import { homeDir } from '@tauri-apps/api/path';
import { SshConnectDialog } from "@/components/dialogs/SshConnectDialog";
import type { SSHConfig } from "@/types/terminal";
import { useSshProfilesStore, type SSHProfile } from "@/store/ssh-profiles";
import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  KeyboardSensor,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// 列表项组件，用于显示单条 SSH 配置并支持拖拽句柄
interface ProfileListItemProps {
  profile: SSHProfile;
  onConnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function ProfileListItem({ profile, onConnect, onEdit, onDelete }: ProfileListItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: profile.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between p-2 bg-white rounded shadow-sm hover:bg-gray-50"
      title={profile.config.nickname || `${profile.config.username}@${profile.config.host}`}
    >
      <div className="flex items-center gap-2 flex-1 cursor-pointer min-w-0" onClick={onConnect}>
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3 w-3 text-muted-foreground" />
        </span>
        <span className="truncate text-xs">
          {profile.config.nickname || `${profile.config.username}@${profile.config.host}`}
        </span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 hover:bg-accent hover:text-accent-foreground"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          title="编辑配置"
        >
          <Pencil className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 hover:bg-destructive hover:text-destructive-foreground"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="删除配置"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export function SessionModule() {
  const { addSession } = useTabsStore();
  const [open, setOpen] = useState(false);
  const [sshDialogOpen, setSshDialogOpen] = useState(false);
  const {
    profiles,
    addProfile,
    updateProfile,
    removeProfile,
    reorderProfiles,
  } = useSshProfilesStore();

  const [editingProfile, setEditingProfile] = useState<SSHProfile | null>(null);

  const handleCreateLocalSession = async () => {
    const home = await homeDir();
    addSession({
      title: `Local-${Date.now()}`,
      type: "local",
      cwd: home,
    });
    setOpen(false);
  };

  // 保存新配置或更新已有配置
  const handleSaveProfile = (config: SSHConfig) => {
    if (editingProfile) {
      updateProfile(editingProfile.id, config);
    } else {
      addProfile(config);
    }
    setEditingProfile(null);
    setSshDialogOpen(false);
    setOpen(false);
  };

  // 使用配置发起会话
  const connectProfile = (config: SSHConfig) => {
    const title = config.nickname || `${config.username}@${config.host}`;
    addSession({
      title,
      type: "ssh",
      host: config.host,
      config: {
        host: config.host,
        port: config.port,
        sshConfig: config,
      },
    });
  };

  // dnd-kit 传感器配置
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: { active: { id: string | number }; over: { id: string | number } | null }) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const ids = profiles.map(p => p.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      const newOrder = arrayMove(ids, oldIndex, newIndex);
      reorderProfiles(newOrder);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b flex items-center justify-between">
        <h3 className="font-medium">会话管理</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="h-4 w-4 mr-1" />
              新建
            </Button>
          </DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>新建会话</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-4">
              <Button 
                variant="outline" 
                className="justify-start"
                onClick={handleCreateLocalSession}
              >
                <Terminal className="h-4 w-4 mr-2" />
                本地终端
              </Button>
              <Button 
                variant="outline" 
                className="justify-start"
                onClick={() => {
                  setOpen(false);
                  setSshDialogOpen(true);
                }}
              >
                <Server className="h-4 w-4 mr-2" />
                SSH 连接
              </Button>
              <Button variant="outline" className="justify-start" disabled>
                <FolderPlus className="h-4 w-4 mr-2" />
                Telnet (开发中)
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2">
        {profiles.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            暂无 SSH 配置<br />
            请使用上方按钮添加
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={profiles.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {profiles
                  .sort((a, b) => a.order - b.order)
                  .map((p) => (
                    <ProfileListItem
                      key={p.id}
                      profile={p}
                      onConnect={() => connectProfile(p.config)}
                      onEdit={() => {
                        setEditingProfile(p);
                        setSshDialogOpen(true);
                      }}
                      onDelete={() => removeProfile(p.id)}
                    />
                  ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* SSH 配置对话框 */}
      <SshConnectDialog
        open={sshDialogOpen}
        onOpenChange={(o) => {
          setSshDialogOpen(o);
          if (!o) setEditingProfile(null);
        }}
        onSave={handleSaveProfile}
        initialConfig={editingProfile?.config}
      />
    </div>
  );
}

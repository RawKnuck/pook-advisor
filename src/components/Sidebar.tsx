"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from 'next/link';

interface Chat {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface SidebarProps {
  activeChatId?: string;
}

export default function Sidebar({ activeChatId }: SidebarProps) {
  const [chats, setChats] = useState<Chat[]>(() => {
    if (typeof window !== "undefined") {
      const cached = sessionStorage.getItem("pook_chats_cache");
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          return [];
        }
      }
    }
    return [];
  });
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const router = useRouter();

  const fetchChats = async () => {
    try {
      const res = await fetch("/api/chats");
      if (res.ok) {
        const data = await res.json();
        const list = data.chats || [];
        setChats(list);
        if (typeof window !== "undefined") {
          sessionStorage.setItem("pook_chats_cache", JSON.stringify(list));
        }
      }
    } catch (err) {
      console.error("Error fetching Pook chats:", err);
    }
  };

  useEffect(() => {
    fetchChats();
  }, []);

  const handleNewChat = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Pook Consultation" }),
      });
      if (res.ok) {
        const data = await res.json();
        const updatedList = [data.chat, ...chats];
        setChats(updatedList);
        if (typeof window !== "undefined") {
          sessionStorage.setItem("pook_chats_cache", JSON.stringify(updatedList));
        }
        router.push(`/chat/${data.chat.id}`);
      }
    } catch (err) {
      console.error("Error creating Pook chat:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this consultation log?")) return;
    try {
      const res = await fetch(`/api/chats/${id}`, { method: "DELETE" });
      if (res.ok) {
        const updatedList = chats.filter((c) => c.id !== id);
        setChats(updatedList);
        if (typeof window !== "undefined") {
          sessionStorage.setItem("pook_chats_cache", JSON.stringify(updatedList));
        }
        if (activeChatId === id) {
          router.push("/");
        }
      }
    } catch (err) {
      console.error("Error deleting Pook chat:", err);
    }
  };

  const startRename = (id: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingChatId(id);
    setEditTitle(title);
  };

  const handleRename = async (id: string) => {
    if (!editTitle.trim()) {
      setEditingChatId(null);
      return;
    }
    try {
      const res = await fetch(`/api/chats/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle.trim() }),
      });
      if (res.ok) {
        const updatedList = chats.map((c) =>
          c.id === id ? { ...c, title: editTitle.trim() } : c
        );
        setChats(updatedList);
        if (typeof window !== "undefined") {
          sessionStorage.setItem("pook_chats_cache", JSON.stringify(updatedList));
        }
      }
    } catch (err) {
      console.error("Error renaming Pook chat:", err);
    } finally {
      setEditingChatId(null);
    }
  };

  const handleSignOut = async () => {
    const { signOut } = await import("next-auth/react");
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("pook_chats_cache");
    }
    await signOut({ callbackUrl: "/login" });
  };

  if (isCollapsed) {
    return (
      <aside className="sidebar-collapsed">
        <button
          onClick={() => setIsCollapsed(false)}
          title="Expand Index"
          className="sidebar-icon-btn"
        >
          ►
        </button>
        <button
          onClick={handleNewChat}
          title="New Consultation"
          className="sidebar-icon-btn"
        >
          ＋
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <Link href="/" className="sidebar-brand">
          The Pook Advisor
        </Link>
        <button
          onClick={() => setIsCollapsed(true)}
          title="Collapse Index"
          className="sidebar-collapse-btn"
        >
          ◄
        </button>
      </div>

      <button
        onClick={handleNewChat}
        disabled={loading}
        className="sidebar-new-btn"
      >
        {loading ? "Creating..." : "＋ New Consultation"}
      </button>

      <div className="sidebar-chat-list">
        {chats.length === 0 ? (
          <div className="sidebar-empty">No past consultations.</div>
        ) : (
          chats.map((chat) => {
            const isActive = chat.id === activeChatId;
            const isEditing = chat.id === editingChatId;
            return (
              <div
                key={chat.id}
                onClick={() => !isEditing && router.push(`/chat/${chat.id}`)}
                className={`sidebar-chat-item${isActive ? " active" : ""}`}
                style={{ cursor: isEditing ? "default" : "pointer" }}
              >
                {isEditing ? (
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => handleRename(chat.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(chat.id);
                      if (e.key === "Escape") setEditingChatId(null);
                    }}
                    autoFocus
                    className="sidebar-edit-input"
                  />
                ) : (
                  <>
                    <span className={`sidebar-chat-title${isActive ? " active" : ""}`}>
                      {chat.title}
                    </span>
                    <div className="sidebar-chat-actions">
                      <button
                        onClick={(e) => startRename(chat.id, chat.title, e)}
                        title="Rename Consultation"
                        className="sidebar-action-btn"
                      >
                        ✎
                      </button>
                      <button
                        onClick={(e) => handleDeleteChat(chat.id, e)}
                        title="Delete Consultation"
                        className="sidebar-delete-btn"
                      >
                        ✕
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="sidebar-footer">
        <button onClick={handleSignOut} className="sidebar-signout-btn">
          Sign Out
        </button>
      </div>
    </aside>
  );
}

"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';

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
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const router = useRouter();
  const sessionData = useSession();
  const session = sessionData?.data;

  const CACHE_KEY = "pook_sessions_cache";

  useEffect(() => {
    // Populate immediately from sessionStorage to eliminate visual flashes
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        setChats(JSON.parse(cached));
        setLoading(false);
      }
    } catch (e) {
      console.warn("Failed to read Pook sessions cache:", e);
    }

    async function fetchChats() {
      try {
        const res = await fetch('/api/chats');
        if (res.ok) {
          const data = await res.json();
          const fetchedChats = data.chats || [];
          setChats(fetchedChats);
          try {
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(fetchedChats));
          } catch (e) {
            console.warn("Failed to update Pook sessions cache:", e);
          }
        }
      } catch (err) {
        console.error('Failed to fetch Pook chats:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchChats();
  }, []);

  const handleStartEdit = (chat: Chat, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setEditingId(chat.id);
    setEditTitle(chat.title);
  };

  const handleSaveRename = async (chatId: string) => {
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }
    try {
      const res = await fetch(`/api/chats/${chatId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle.trim() }),
      });
      if (res.ok) {
        const updated = chats.map((c) =>
          c.id === chatId ? { ...c, title: editTitle.trim() } : c
        );
        setChats(updated);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(updated));
        } catch (e) {
          console.warn("Failed to update Pook sessions cache:", e);
        }
      }
    } catch (err) {
      console.error('Failed to rename Pook chat:', err);
    } finally {
      setEditingId(null);
    }
  };

  const handleDelete = async (chatId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this consultation log?')) return;

    try {
      const res = await fetch(`/api/chats/${chatId}`, { method: 'DELETE' });
      if (res.ok) {
        const updated = chats.filter((c) => c.id !== chatId);
        setChats(updated);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(updated));
        } catch (e) {
          console.warn("Failed to update Pook sessions cache:", e);
        }
        if (activeChatId === chatId) {
          router.push('/');
        }
      }
    } catch (err) {
      console.error('Failed to delete Pook chat:', err);
    }
  };

  if (collapsed) {
    return (
      <aside className="sidebar-collapsed">
        <button
          onClick={() => setCollapsed(false)}
          className="sidebar-toggle-btn"
          title="Expand Log Index"
        >
          ►
        </button>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title-row">
          <Link href="/" className="sidebar-brand">
            The Pook Advisor
          </Link>
          <button
            onClick={() => setCollapsed(true)}
            className="sidebar-collapse-btn"
            title="Collapse Index"
          >
            ◄
          </button>
        </div>
        <Link href="/" className="sidebar-new-btn">
          + New Consultation
        </Link>
      </div>

      <div className="sidebar-section-label">Consultation History</div>

      <div className="sidebar-chat-list">
        {loading && chats.length === 0 ? (
          <div className="sidebar-loading">Loading logs...</div>
        ) : chats.length === 0 ? (
          <div className="sidebar-empty">No prior consultations.</div>
        ) : (
          chats.map((chat) => {
            const isActive = chat.id === activeChatId;
            const isEditing = editingId === chat.id;

            return (
              <div
                key={chat.id}
                className={`sidebar-chat-item ${isActive ? 'active' : ''}`}
              >
                {isEditing ? (
                  <input
                    type="text"
                    className="sidebar-rename-input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => handleSaveRename(chat.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveRename(chat.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    autoFocus
                  />
                ) : (
                  <Link href={`/chat/${chat.id}`} className="sidebar-chat-link">
                    <span className="sidebar-chat-title">{chat.title}</span>
                  </Link>
                )}

                {!isEditing && (
                  <div className="sidebar-item-actions">
                    <button
                      onClick={(e) => handleStartEdit(chat, e)}
                      className="sidebar-action-btn"
                      title="Rename"
                    >
                      ✎
                    </button>
                    <button
                      onClick={(e) => handleDelete(chat.id, e)}
                      className="sidebar-action-btn delete"
                      title="Delete"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {session?.user && (
        <div className="sidebar-footer">
          <div className="sidebar-user-info">
            <span className="sidebar-user-email">{session.user.email}</span>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="sidebar-signout-btn"
          >
            Sign Out
          </button>
        </div>
      )}
    </aside>
  );
}

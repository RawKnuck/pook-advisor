"use client";

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSession } from 'next-auth/react';
import Sidebar from '@/components/Sidebar';
import { renderMarkdown } from '@/lib/markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  image_url?: string | null;
}

export default function Home() {
  const [messages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Greetings. I am Pook. Drawing from the wisdom of "The Book of Pook", what situation with dating, attraction, inner game, or manhood do you need to navigate?'
    }
  ]);
  const [input, setInput] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const [activeImageModal, setActiveImageModal] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Authentication check
  useEffect(() => {
    async function checkAuth() {
      const session = await getSession();
      if (!session) {
        window.location.href = "/login";
      }
    }
    checkAuth();
  }, []);

  // Close modal on Escape key press
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && activeImageModal) {
        setActiveImageModal(null);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [activeImageModal]);

  // Auto scroll to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input]);

  const processImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Image size exceeds 10MB limit.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      if (typeof e.target?.result === 'string') {
        setAttachedImage(e.target.result);
        setError(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (file) processImageFile(file);
        break;
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (files && files.length > 0 && files[0].type.startsWith('image/')) {
      processImageFile(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && !attachedImage) || loading) return;

    setError(null);
    const userQuery = input.trim();
    const userImage = attachedImage;
    setInput('');
    setAttachedImage(null);
    setLoading(true);

    try {
      const title = userQuery ? (userQuery.length > 30 ? userQuery.substring(0, 30) + '...' : userQuery) : 'Pook Consultation';
      const createRes = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });

      if (!createRes.ok) {
        throw new Error('Failed to initiate a new Pook session.');
      }

      const { chat } = await createRes.json();

      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: chat.id,
          content: userQuery,
          image: userImage
        })
      });

      if (!chatRes.ok) {
        const errData = await chatRes.json();
        throw new Error(errData.error || 'Server responded with an error.');
      }

      router.push(`/chat/${chat.id}`);
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(errorMessage);
      setLoading(false);
    }
  };

  return (
    <div className="sidebar-layout">
      <Sidebar />
      <div className="sidebar-main-content">
        <main className="paper-container">
          <header className="academic-header">
            <h1 className="academic-title">The Pook Advisor</h1>
            <p className="academic-subtitle">Strategic Counsel grounded in Inner Game, Masculinity, and The Book of Pook</p>
            <div className="latex-divider"></div>
          </header>

          <section className="chat-log">
            {messages.map((m, idx) => (
              <div key={idx} className="message-block">
                <div className={`message-meta ${m.role === 'user' ? 'user' : 'advisor'}`}>
                  {m.role === 'user' ? 'Seeker (You)' : 'Pook'}
                </div>
                {m.image_url && (
                  <div className="message-image-container">
                    <img
                      src={m.image_url}
                      alt="Attached context"
                      className="message-image"
                      onClick={() => setActiveImageModal(m.image_url!)}
                      title="Click to view full image"
                    />
                  </div>
                )}
                {m.content && <div className="message-content">{renderMarkdown(m.content)}</div>}
              </div>
            ))}

            {loading && (
              <div className="status-indicator">
                Pook is formulating counsel...
              </div>
            )}

            {error && (
              <div className="error-banner">
                Error: {error}
              </div>
            )}
            
            <div ref={chatEndRef} />
          </section>

          <form onSubmit={handleSubmit} className="input-form" onDrop={handleDrop} onDragOver={handleDragOver}>
            {attachedImage && (
              <div className="image-preview-bar">
                <div className="image-preview-wrapper">
                  <img
                    src={attachedImage}
                    alt="Attached preview"
                    className="image-preview-thumb"
                    onClick={() => setActiveImageModal(attachedImage)}
                    title="Click to view full image"
                  />
                  <button
                    type="button"
                    onClick={() => setAttachedImage(null)}
                    className="image-preview-remove-btn"
                    title="Remove image"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}
            <div className="input-row">
              <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    processImageFile(e.target.files[0]);
                    e.target.value = '';
                  }
                }}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
                className="attach-btn"
                title="Attach image"
              >
                📎
              </button>
              <textarea
                ref={textareaRef}
                className="chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Ask Pook about dating, mindset, womanese, or inner game..."
                disabled={loading}
                required={!attachedImage}
                autoFocus
                rows={1}
                style={{
                  resize: 'none',
                  overflowY: 'auto',
                  minHeight: '44px',
                  maxHeight: '200px',
                  paddingTop: '10px',
                  paddingBottom: '10px',
                  lineHeight: '1.4',
                }}
              />
              <button type="submit" className="submit-btn" disabled={loading || (!input.trim() && !attachedImage)}>
                Consult Pook
              </button>
            </div>
          </form>
        </main>
      </div>

      {activeImageModal && (
        <div className="image-modal-overlay" onClick={() => setActiveImageModal(null)}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="image-modal-close-btn"
              onClick={() => setActiveImageModal(null)}
              title="Close preview"
            >
              ✕
            </button>
            <img src={activeImageModal} alt="Expanded preview" className="image-modal-img" />
          </div>
        </div>
      )}
    </div>
  );
}

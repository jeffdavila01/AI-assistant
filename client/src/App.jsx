import SearchToggle from "./components/SearchToggle";
import ProcessingStatus from "./components/ProcessingStatus";
import FreebuffAgent from "./components/FreebuffAgent";
import CodingWorkspace from "./components/CodingWorkspace";
import MemorySettings from "./components/MemorySettings";
import { useState, useEffect, useRef } from "react";
import {
  Bot, Plus, Search, Send, Menu, X,
  Sparkles, Code2, Brain, Lightbulb,
  FileText, MessageSquare, Trash2,
  Sun, Moon, Copy, Check, Square, RefreshCw, FolderTree
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./App.css";

import { getModels, streamChat } from "./services/ai";

function createChat() {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    messages: []
  };
}

function loadChats() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("ai-assistant-chats") || "[]"
    );
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [workspace, setWorkspace] = useState("chat");
  const [chats, setChats] = useState(() => {
    const saved = loadChats();
    return saved.length ? saved : [createChat()];
  });

  const [activeId, setActiveId] = useState(chats[0].id);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [runningChats, setRunningChats] = useState({});
  const [webSearch, setWebSearch] = useState(false);
  const [codingDraft, setCodingDraft] = useState("");
  const [processing, setProcessing] = useState({});

  function updateProcessing(id, changes) {
    setProcessing(previous => ({
      ...previous,
      [id]: {
        ...previous[id],
        ...changes
      }
    }));
  }
  const [chatErrors, setChatErrors] = useState({});
  const [globalError, setGlobalError] = useState("");
  const [sidebar, setSidebar] = useState(
    window.innerWidth > 768
  );
  const [theme, setTheme] = useState(
    () => localStorage.getItem("ai-assistant-theme") || "dark"
  );
  const [copied, setCopied] = useState(null);

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const requestsRef = useRef(new Map());
  const loading = Boolean(runningChats[activeId]);
  const pendingChatId = loading ? activeId : null;
  const error = chatErrors[activeId] || globalError;

  function setError(message) {
    setChatErrors(prev => ({
      ...prev,
      [activeId]: message
    }));

    if (!message) setGlobalError("");
  }

  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("auto");

  useEffect(() => {
    getModels()
      .then(setModels)
      .catch(err => setGlobalError(err.message));
  }, []);

  function stopGeneration() {
    requestsRef.current.get(activeId)?.abort();
  }

  const activeChat = chats.find(c => c.id === activeId);
  const messages = activeChat?.messages || [];

  useEffect(() => {
    localStorage.setItem(
      "ai-assistant-chats",
      JSON.stringify(chats)
    );
  }, [chats]);

  useEffect(() => {
    localStorage.setItem("ai-assistant-theme", theme);
  }, [theme]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth"
    });
  }, [messages, loading]);

  function newChat() {
    setWorkspace("chat");
    const chat = createChat();

    setChats(prev => [chat, ...prev]);
    setActiveId(chat.id);
    setInput("");
    setError("");

    if (window.innerWidth <= 768) {
      setSidebar(false);
    }

    textareaRef.current?.focus();
  }

  function selectChat(id) {
    setWorkspace("chat");
    setActiveId(id);
    setError("");
    setInput("");

    if (window.innerWidth <= 768) {
      setSidebar(false);
    }
  }

  function deleteChat(id) {
    if (requestsRef.current.has(id)) return;

    if (!window.confirm("Delete this conversation?")) {
      return;
    }

    const remaining = chats.filter(c => c.id !== id);

    if (!remaining.length) {
      const chat = createChat();
      setChats([chat]);
      setActiveId(chat.id);
    } else {
      setChats(remaining);

      if (activeId === id) {
        setActiveId(remaining[0].id);
      }
    }
  }

  async function sendMessage(text = input, regenerate = false) {
    const content = text.trim();

    if (requestsRef.current.has(activeId) || !activeChat) return;

    if (requestsRef.current.size >= 3) {
      setError("Maximum of 3 active AI conversations.");
      return;
    }
    if (!regenerate && !content) return;

    const chatId = activeId;

    const history = regenerate
      ? messages.slice(0, -1)
      : [...messages, { role: "user", content }];

    if (!history.length ||
        history.at(-1).role !== "user") return;

    const controller = new AbortController();

    requestsRef.current.set(chatId, controller);

    const searchRequested = webSearch;

    let finalStatus = "error";
    let firstTokenAt = null;

    updateProcessing(chatId, {
      status: "connecting",
      startedAt: Date.now(),
      finishedAt: null,
      firstTokenAt: null,
      model: "",
      position: null,
      sourceCount: null
    });

    setRunningChats(prev => ({
      ...prev,
      [chatId]: true
    }));
    setInput("");
    setError("");

    let accumulated = "";
    let actualModel = "";

    const updateAssistant = (status = "streaming") => {
      setChats(prev => prev.map(chat =>
        chat.id === chatId
          ? {
              ...chat,
              messages: [
                ...history,
                {
                  role: "assistant",
                  content: accumulated,
                  model: actualModel,
                  status
                }
              ]
            }
          : chat
      ));
    };

    setChats(prev => prev.map(chat =>
      chat.id === chatId
        ? {
            ...chat,
            title: chat.messages.length
              ? chat.title
              : content.slice(0, 45),
            messages: history
          }
        : chat
    ));

    try {
      await streamChat({
        messages: history
          .filter(message => message.content.trim())
          .slice(-49)
          .map(({ role, content }, index, items) => ({
            role,
            content:
              searchRequested &&
              index === items.length - 1 &&
              role === "user" &&
              !/^\/search\s/i.test(content)
                ? "/search " + content
                : content
          })),
        model: selectedModel,
        signal: controller.signal,

        onEvent(event) {

          if (event.type === "searching") {
            updateProcessing(chatId, {
              status: "searching"
            });
          }

          if (event.type === "search_results") {
            updateProcessing(chatId, {
              status: "analyzing",
              sourceCount: event.total
            });
          }

          if (event.type === "queued") {
            updateProcessing(chatId, {
              status: "queued",
              position: event.position
            });
          }

          if (event.type === "done") {
            finalStatus = "completed";
          }
          if (event.type === "model") {
            actualModel = event.model;

            updateProcessing(chatId, {
              status: "generating",
              model: actualModel,
              position: null
            });
          }

          if (event.type === "delta") {
            if (firstTokenAt === null) {
              firstTokenAt = Date.now();

              updateProcessing(chatId, {
                firstTokenAt
              });
            }

            accumulated += event.text;
            updateAssistant();
          }

          if (event.type === "done") {
            actualModel = event.model;

            updateProcessing(chatId, {
              status: "generating",
              model: actualModel,
              position: null
            });
            updateAssistant("completed");
          }
        }
      });

    } catch (err) {
      if (accumulated) {
        updateAssistant(
          controller.signal.aborted
            ? "stopped"
            : "interrupted"
        );
      }

      if (!controller.signal.aborted) {
        setError(
          err.message === "Failed to fetch"
            ? "Cannot connect to the AI server."
            : err.message
        );
      }
    } finally {
      updateProcessing(chatId, {
        status: controller.signal.aborted
          ? "stopped"
          : finalStatus,
        finishedAt: Date.now()
      });

      requestsRef.current.delete(chatId);

      setRunningChats(prev => {
        const next = { ...prev };
        delete next[chatId];
        return next;
      });
    }
  }

  async function copyMessage(content, index) {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(index);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setError("Unable to copy the message.");
    }
  }

  const suggestions = [
    {
      icon: Code2,
      title: "Write code",
      prompt: "Help me build a modern website."
    },
    {
      icon: Brain,
      title: "Learn something",
      prompt: "Explain artificial intelligence simply."
    },
    {
      icon: Lightbulb,
      title: "Brainstorm",
      prompt: "Give me creative software project ideas."
    },
    {
      icon: FileText,
      title: "Write content",
      prompt: "Help me write a professional introduction."
    }
  ];

  return (
    <div className={`app ${theme}`}>

      {sidebar && (
        <aside className="sidebar">
          <div className="brand">
            <Bot size={27} />
            <strong>AI-assistant</strong>
            <button
              className="icon-button"
              aria-label="Close sidebar"
              onClick={() => setSidebar(false)}
            >
              <X size={18} />
            </button>
          </div>

          <button className="new-chat" onClick={newChat}>
            <Plus size={19} />
            New chat
          </button>

          <div className="search-box">
            <Search size={17} />
            <input
              placeholder="Search chats..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="history">
            <p className="section-label">Conversations</p>

            {chats
              .filter(c => c.title.toLowerCase().includes(
                search.toLowerCase()
              ))
              .map(chat => (
                <div
                  key={chat.id}
                  className={
                    "chat-item " +
                    (chat.id === activeId ? "active" : "")
                  }
                >
                  <button
                    className="chat-title"
                    onClick={() => selectChat(chat.id)}
                  >
                    <MessageSquare size={16} />
                    <span>{chat.title}</span>

{runningChats[chat.id] && (
  <span
    className={
      processing[chat.id]?.status === "queued"
        ? "chat-queued-indicator"
        : "chat-running-spinner"
    }
    title={
      processing[chat.id]?.status === "queued"
        ? "Waiting in queue"
        : processing[chat.id]?.status === "searching"
          ? "Searching online"
          : "Processing response"
    }
    aria-label="Generating response"
  />
)}
                  </button>

                  <button
                    className="icon-button delete-chat"
                    aria-label="Delete conversation"
                    disabled={Boolean(runningChats[chat.id])}
                    onClick={() => deleteChat(chat.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
          </div>

          <div className="workspace-navigation">
  <p className="section-label">Workspace</p>

  <button
    className={`theme-button workspace-link ${workspace === "chat" ? "selected" : ""}`}
    onClick={() => {
      setWorkspace("chat");
      if (window.innerWidth <= 768) setSidebar(false);
    }}
  >
    <MessageSquare size={18} />
    AI Chat
  </button>

  <button
    className={`theme-button workspace-link ${workspace === "agent" ? "selected" : ""}`}
    onClick={() => {
      setWorkspace("agent");
      if (window.innerWidth <= 768) setSidebar(false);
    }}
  >
    <Code2 size={18} />
    Freebuff Agent
  </button>

  <button
    className={`theme-button workspace-link ${workspace === "projects" ? "selected" : ""}`}
    onClick={() => {
      setWorkspace("projects");
      if (window.innerWidth <= 768) setSidebar(false);
    }}
  >
    <FolderTree size={18} />
    Coding Workspace
  </button>
</div>
          <MemorySettings />

          <button
            className="theme-button"
            onClick={() => setTheme(
              theme === "dark" ? "light" : "dark"
            )}
          >
            {theme === "dark" ? <Sun size={18} /> :
              <Moon size={18} />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>

          <div className="sidebar-footer">
            AI-assistant v0.1.0
          </div>
        </aside>
      )}

      <main className="main" hidden={workspace !== "chat"}>
        <header className="topbar">
          <button
            className="icon-button"
            aria-label="Toggle sidebar"
            onClick={() => setSidebar(!sidebar)}
          >
            <Menu size={22} />
          </button>

          <div className="model-label">
            <strong>AI-assistant</strong>
            <span>Intelligent AI workspace</span>
          </div>

          <button
            className="icon-button header-new"
            aria-label="New conversation"
            onClick={newChat}
          >
            <Plus size={22} />
          </button>
        </header>

        <section className="conversation">
          {!messages.length ? (
            <div className="welcome">
              <div className="welcome-icon">
                <Sparkles size={38} />
              </div>

              <h1>How can I help you today?</h1>
              <p>Your intelligent everyday assistant.</p>

              <div className="suggestions">
                {suggestions.map(item => (
                  <button
                    key={item.title}
                    disabled={loading}
                    onClick={() => sendMessage(item.prompt)}
                  >
                    <item.icon size={22} />
                    <span>{item.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message, index) => (
                <article
                  key={index}
                  className={`message ${message.role}`}
                >
                  {message.role === "assistant" && (
                    <div className="assistant-avatar">
                      <Bot size={22} />
                    </div>
                  )}

                  <div className="message-content">
                    {message.role === "assistant" ? (
                      <>
                        {message.model && (
  <div className="response-model">
    {message.model}
    {message.status === "stopped" && " - Stopped"}
    {message.status === "interrupted" && " - Interrupted"}
  </div>
)}
<ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                        >
                          {message.content}
                        </ReactMarkdown>

                        <button
                          className="icon-button copy-button"
                          aria-label="Copy response"
                          onClick={() =>
                            copyMessage(message.content, index)
                          }
                        >
                          {copied === index
                            ? <Check size={17} />
                            : <Copy size={17} />}
                        </button>

                        {index === messages.length - 1 && !loading && (
                          <button
                            className="icon-button"
                            aria-label="Regenerate response"
                            title="Regenerate response"
                            onClick={() => sendMessage("", true)}
                          >
                            <RefreshCw size={17} />
                          </button>
                        )}
                      </>
                    ) : (
                      <p>{message.content}</p>
                    )}
                  </div>
                </article>
              ))}

              {loading && pendingChatId === activeId && (
                <div className="thinking">
                  <Bot size={22} />
                  <span>AI-assistant is thinking...</span>
                  <div className="loading-dot" />
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          )}
        </section>

        <footer className="composer-area">

          <ProcessingStatus
            request={processing[activeId]}
          />
          {error && (
            <div className="error-message" role="alert">
              {error}
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}

          <form
            className="composer"
            onSubmit={e => {
              e.preventDefault();
              sendMessage();
            }}
          >
            <textarea
              ref={textareaRef}
              placeholder="Ask AI-assistant anything..."
              value={input}
              rows={2}
              maxLength={20000}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />

            <div className="composer-bottom">

              <SearchToggle
                enabled={webSearch}
                onChange={setWebSearch}
                disabled={loading}
              />

              <button
                type="button"
                className="composer-coding"
                title="Send this prompt to the coding workspace"
                disabled={!input.trim()}
                onClick={() => {
                  setCodingDraft(input.trim());
                  setInput("");
                  setWorkspace("projects");
                }}
              >
                <Code2 size={16} />
                Build
              </button>
              <div className="model-tag">
                <Sparkles size={15} />

                <select
                  className="model-select"
                  aria-label="Select AI model"
                  value={selectedModel}
                  disabled={loading}
                  onChange={e => setSelectedModel(e.target.value)}
                >
                  <option value="auto">Auto</option>

                  {models.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </div>

              {loading ? (
                <button
                  type="button"
                  className="send-button"
                  aria-label="Stop generating"
                  onClick={stopGeneration}
                >
                  <Square size={16} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-button"
                  aria-label="Send message"
                  disabled={!input.trim()}
                >
                  <Send size={19} />
                </button>
              )}
            </div>

          </form>

          <p className="disclaimer">
            AI can make mistakes. Verify important information.
          </p>
        </footer>
      </main>

<FreebuffAgent
  visible={workspace === "agent"}
  onBack={() => setWorkspace("chat")}
  onMenu={() => setSidebar(prev => !prev)}
/>

<CodingWorkspace
  visible={workspace === "projects"}
  onBack={() => setWorkspace("chat")}
  onMenu={() => setSidebar(prev => !prev)}
  draft={codingDraft}
  onDraftChange={setCodingDraft}
/>
    </div>
  );
}







'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { cn } from '@/lib/utils';
import { RefreshCw, Plus, X, ChevronDown, Copy, ClipboardPaste } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

interface TerminalTab {
  id: string;
  title: string;
  terminal: XTerm | null;
  fitAddon: FitAddon | null;
  ws: WebSocket | null;
}

interface TerminalProps {
  windowId?: string;
}

export const Terminal = ({ windowId }: TerminalProps) => {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const createNewTab = useCallback(() => {
    const newTab: TerminalTab = {
      id: crypto.randomUUID(),
      title: `Terminal ${tabs.length + 1}`,
      terminal: null,
      fitAddon: null,
      ws: null,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    return newTab.id;
  }, [tabs.length]);

  const closeTab = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      tab.ws?.close();
      tab.terminal?.dispose();
    }
    
    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);
    
    if (activeTabId === tabId && newTabs.length > 0) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
    }
  }, [tabs, activeTabId]);

  const initializeTerminal = useCallback(async (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (!tab || tab.terminal || !terminalContainerRef.current) return;

    setIsConnecting(true);
    setError(null);

    try {
      // Create terminal
      const term = new XTerm({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'JetBrains Mono, Monaco, Menlo, monospace',
        theme: {
          background: '#1a1a2e',
          foreground: '#e4e4e7',
          cursor: '#3b82f6',
          cursorAccent: '#1a1a2e',
          selectionBackground: '#3b82f640',
          black: '#16161e',
          red: '#f7768e',
          green: '#9ece6a',
          yellow: '#e0af68',
          blue: '#7aa2f7',
          magenta: '#bb9af7',
          cyan: '#7dcfff',
          white: '#a9b1d6',
          brightBlack: '#414868',
          brightRed: '#f7768e',
          brightGreen: '#9ece6a',
          brightYellow: '#e0af68',
          brightBlue: '#7aa2f7',
          brightMagenta: '#bb9af7',
          brightCyan: '#7dcfff',
          brightWhite: '#c0caf5',
        },
        allowProposedApi: true,
        scrollback: 5000,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      // Get or create terminal container for this tab
      const container = document.getElementById(`terminal-${tabId}`);
      if (container) {
        term.open(container);
        fitAddon.fit();
      }

      // Connect to WebSocket terminal
      // Use the API subdomain for WebSocket connection (nginx proxies to backend)
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      // Replace 'nas.' with 'nas-api.' for API endpoint, or use port 3000 for local dev
      const apiHost = window.location.hostname.replace('nas.', 'nas-api.');
      const wsHost = window.location.protocol === 'https:' 
        ? apiHost  // Production: use nas-api.koimsurai.com (nginx proxies to backend)
        : `${window.location.hostname}:3000`;  // Dev: direct to port 3000
      const wsUrl = `${protocol}//${wsHost}/api/terminal?cols=${term.cols}&rows=${term.rows}`;
      
      // Include credentials cookie for authentication
      const ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        setIsConnecting(false);
        
        // Manual data handling for our custom restricted shell
        // (Not using AttachAddon since our backend sends plain text, not PTY binary)
        ws.onmessage = (event) => {
          term.write(event.data);
        };

        term.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });

        term.focus();
      };

      ws.onerror = () => {
        setIsConnecting(false);
        // Fallback to local simulation if WebSocket fails
        term.writeln('\x1b[33m⚠ WebSocket connection failed. Running in demo mode.\x1b[0m');
        term.writeln('');
        term.writeln('\x1b[32mWelcome to Koimsurai NAS Terminal\x1b[0m');
        term.writeln('\x1b[90m─────────────────────────────────\x1b[0m');
        term.writeln('');
        simulateTerminal(term);
      };

      ws.onclose = () => {
        if (tab.terminal) {
          term.writeln('\r\n\x1b[31mConnection closed.\x1b[0m');
        }
      };

      // Update tab with terminal instances
      setTabs(prev => prev.map(t => 
        t.id === tabId 
          ? { ...t, terminal: term, fitAddon, ws }
          : t
      ));

    } catch (err) {
      setIsConnecting(false);
      setError('Failed to initialize terminal');
      console.error('Terminal init error:', err);
    }
  }, [tabs]);

  // Simulate terminal for demo purposes
  const simulateTerminal = (term: XTerm) => {
    let currentLine = '';
    const prompt = '\x1b[36mnas\x1b[0m:\x1b[34m~\x1b[0m$ ';
    
    const commands: Record<string, string> = {
      'help': 'Available commands: help, ls, pwd, date, whoami, clear, echo, uname',
      'ls': 'Desktop  Documents  Downloads  Music  Pictures  Videos',
      'pwd': '/home/user',
      'date': new Date().toString(),
      'whoami': 'user',
      'uname': 'KoimsuraiNAS 1.0.0',
      'clear': '\x1b[2J\x1b[H',
    };

    term.write(prompt);

    term.onData((data) => {
      const code = data.charCodeAt(0);
      
      if (code === 13) { // Enter
        term.writeln('');
        const cmd = currentLine.trim();
        
        if (cmd) {
          if (cmd === 'clear') {
            term.write('\x1b[2J\x1b[H');
          } else if (cmd.startsWith('echo ')) {
            term.writeln(cmd.substring(5));
          } else if (commands[cmd]) {
            term.writeln(commands[cmd]);
          } else {
            term.writeln(`\x1b[31mCommand not found: ${cmd}\x1b[0m`);
          }
        }
        
        currentLine = '';
        term.write(prompt);
      } else if (code === 127) { // Backspace
        if (currentLine.length > 0) {
          currentLine = currentLine.slice(0, -1);
          term.write('\b \b');
        }
      } else if (code >= 32) { // Printable characters
        currentLine += data;
        term.write(data);
      }
    });
  };

  // Initialize first tab on mount
  useEffect(() => {
    if (tabs.length === 0) {
      createNewTab();
    }
  }, [createNewTab, tabs.length]);

  // Initialize terminal when active tab changes
  useEffect(() => {
    if (activeTabId) {
      const tab = tabs.find(t => t.id === activeTabId);
      if (tab && !tab.terminal) {
        // Small delay to ensure DOM is ready
        setTimeout(() => initializeTerminal(activeTabId), 100);
      }
    }
  }, [activeTabId, tabs, initializeTerminal]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab?.fitAddon && activeTab?.terminal) {
        try {
          activeTab.fitAddon.fit();
          // Send new dimensions to server if connected
          if (activeTab.ws?.readyState === WebSocket.OPEN) {
            const dimensions = { cols: activeTab.terminal.cols, rows: activeTab.terminal.rows };
            activeTab.ws.send(JSON.stringify({ type: 'resize', ...dimensions }));
          }
        } catch (e) {
          // Ignore fit errors
        }
      }
    };

    if (terminalContainerRef.current) {
      resizeObserverRef.current = new ResizeObserver(handleResize);
      resizeObserverRef.current.observe(terminalContainerRef.current);
    }

    return () => {
      resizeObserverRef.current?.disconnect();
    };
  }, [activeTabId, tabs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      tabs.forEach(tab => {
        tab.ws?.close();
        tab.terminal?.dispose();
      });
    };
  }, []);

  const activeTab = tabs.find(t => t.id === activeTabId);

  // 複製選中的文字
  const handleCopy = useCallback(() => {
    if (activeTab?.terminal) {
      const selection = activeTab.terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection);
      }
    }
  }, [activeTab]);

  // 貼上剪貼簿內容
  const handlePaste = useCallback(async () => {
    if (activeTab?.ws?.readyState === WebSocket.OPEN) {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          activeTab.ws.send(text);
        }
      } catch (e) {
        console.error('Failed to read clipboard:', e);
      }
    }
  }, [activeTab]);

  // 清除終端
  const handleClear = useCallback(() => {
    if (activeTab?.terminal) {
      activeTab.terminal.clear();
    }
  }, [activeTab]);

  return (
    <div className="flex flex-col h-full bg-[#1a1a2e] rounded-lg overflow-hidden">
      {/* Tab Bar */}
      <div className="h-9 flex items-center bg-[#13132a] border-b border-white/10 shrink-0 px-1">
        <div className="flex-1 flex items-center gap-0.5 overflow-x-auto scrollbar-none">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={cn(
                "group flex items-center gap-1.5 h-7 px-3 rounded-t-md cursor-pointer transition-all duration-150 min-w-0 max-w-[160px]",
                tab.id === activeTabId
                  ? "bg-[#1a1a2e]"
                  : "bg-transparent hover:bg-white/5"
              )}
            >
              <span className={cn(
                "text-xs truncate",
                tab.id === activeTabId
                  ? "text-white font-medium"
                  : "text-gray-400"
              )}>
                {tab.title}
              </span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className={cn(
                    "shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors",
                    tab.id === activeTabId ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  )}
                >
                  <X className="w-3 h-3 text-gray-400" />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1 shrink-0 px-1">
          <button
            onClick={createNewTab}
            className="p-1 rounded hover:bg-white/10 transition-colors"
            title="New Tab"
          >
            <Plus className="w-4 h-4 text-gray-400" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1 rounded hover:bg-white/10 transition-colors">
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[150px]">
              <DropdownMenuItem onClick={createNewTab}>
                <Plus className="w-4 h-4 mr-2" />
                New Terminal
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                if (activeTab?.terminal) {
                  activeTab.terminal.clear();
                }
              }}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Clear Terminal
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Terminal Content */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div ref={terminalContainerRef} className="flex-1 relative">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                id={`terminal-${tab.id}`}
                className={cn(
                  "absolute inset-0 p-2",
                  tab.id === activeTabId ? "block" : "hidden"
                )}
              />
            ))}
            
            {isConnecting && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]/80 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-gray-400">Connecting...</span>
                </div>
              </div>
            )}
            
            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a2e]/80 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3 text-center px-4">
                  <span className="text-red-400">{error}</span>
                  <button
                    onClick={() => activeTabId && initializeTerminal(activeTabId)}
                    className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={handleCopy}>
            <Copy className="w-4 h-4 mr-2" />
            複製
            <span className="ml-auto text-xs text-muted-foreground">⌘C</span>
          </ContextMenuItem>
          <ContextMenuItem onClick={handlePaste}>
            <ClipboardPaste className="w-4 h-4 mr-2" />
            貼上
            <span className="ml-auto text-xs text-muted-foreground">⌘V</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleClear}>
            <RefreshCw className="w-4 h-4 mr-2" />
            清除終端
          </ContextMenuItem>
          <ContextMenuItem onClick={createNewTab}>
            <Plus className="w-4 h-4 mr-2" />
            新分頁
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
};

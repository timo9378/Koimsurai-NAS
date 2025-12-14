'use client';

import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalViewProps {
  logs: string;
  isLoading?: boolean;
}

export const TerminalView = ({ logs, isLoading }: TerminalViewProps) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    const handleResize = () => {
      fitAddon.fit();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  useEffect(() => {
    if (!xtermRef.current) return;

    xtermRef.current.clear();
    
    if (isLoading) {
      xtermRef.current.writeln('Loading logs...');
    } else if (logs) {
      // Split logs by newline and write each line to handle formatting better
      const lines = logs.split('\n');
      lines.forEach(line => {
        xtermRef.current?.writeln(line);
      });
    } else {
      xtermRef.current.writeln('No logs available.');
    }
    
    // Scroll to bottom
    xtermRef.current.scrollToBottom();
  }, [logs, isLoading]);

  return (
    <div className="h-full w-full bg-[#1e1e1e] p-2 rounded-md overflow-hidden">
      <div ref={terminalRef} className="h-full w-full" />
    </div>
  );
};
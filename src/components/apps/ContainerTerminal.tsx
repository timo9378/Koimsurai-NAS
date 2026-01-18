'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { AttachAddon } from '@xterm/addon-attach';
import '@xterm/xterm/css/xterm.css';

interface ContainerTerminalProps {
    containerId: string;
}

export const ContainerTerminal = ({ containerId }: ContainerTerminalProps) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [error, setError] = useState<string | null>(null);

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

        // WebSocket connection
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        // Assuming the backend supports this endpoint. If not, it will fail gracefully.
        const wsUrl = `${protocol}//${host}/api/docker/containers/${containerId}/exec`;

        let socket: WebSocket;

        try {
            socket = new WebSocket(wsUrl);
            const attachAddon = new AttachAddon(socket);
            term.loadAddon(attachAddon);

            socket.onopen = () => {
                term.writeln('\r\n\x1b[32mConnected to container terminal.\x1b[0m\r\n');
                term.focus();
            };

            socket.onerror = () => {
                setError('Failed to connect to terminal endpoint. Backend support may be missing.');
                term.writeln('\r\n\x1b[31mConnection error.\x1b[0m\r\n');
            };

            socket.onclose = () => {
                term.writeln('\r\n\x1b[33mConnection closed.\x1b[0m\r\n');
            };
        } catch (e) {
            setError('Failed to initialize WebSocket.');
        }

        const handleResize = () => {
            fitAddon.fit();
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            term.dispose();
            if (socket) socket.close();
        };
    }, [containerId]);

    if (error) {
        return (
            <div className="h-full flex items-center justify-center text-red-400 bg-[#1e1e1e] p-4 text-center">
                <p>{error}</p>
            </div>
        );
    }

    return (
        <div className="h-full w-full bg-[#1e1e1e] p-2 rounded-md overflow-hidden">
            <div ref={terminalRef} className="h-full w-full" />
        </div>
    );
};

'use client';

import React, { useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform, MotionValue, AnimatePresence } from 'framer-motion';
import {
  Folder,
  LayoutGrid,
  Image as ImageIcon,
  Container,
  Settings,
  Trash2,
  Calculator,
  Terminal,
  Activity,
  X,
  Monitor,
  ArrowLeft,
  ArrowRight,
  ArrowDown
} from 'lucide-react';
import { useWindowStore, AppType, WindowState } from '@/store/window-store';
import { cn } from '@/lib/utils';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Popover from '@radix-ui/react-popover';

interface DockItemProps {
  mouseX: MotionValue;
  icon: React.ElementType;
  label: string;
  appType: AppType;
  isOpen: boolean;
  windows: WindowState[];
  onClick: () => void;
  onRightClick: () => void;
  onCloseWindow: (id: string) => void;
  onFocusWindow: (id: string) => void;
}

const DockPreview = ({
  windows,
  onClose,
  onFocus
}: {
  windows: WindowState[],
  onClose: (id: string) => void,
  onFocus: (id: string) => void
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      className="absolute bottom-full mb-4 left-1/2 -translate-x-1/2 flex gap-2 p-2 bg-white/10 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl z-50"
    >
      {windows.map((window) => (
        <div
          key={window.id}
          className="group relative w-32 h-24 bg-black/40 rounded-lg border border-white/10 overflow-hidden cursor-pointer hover:bg-black/60 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onFocus(window.id);
          }}
        >
          {/* Window Title Bar Preview */}
          <div className="h-4 bg-white/10 flex items-center px-1 gap-1">
            <div className="w-1 h-1 rounded-full bg-red-400" />
            <div className="w-1 h-1 rounded-full bg-yellow-400" />
            <div className="w-1 h-1 rounded-full bg-green-400" />
            <span className="text-[8px] text-white/70 ml-1 truncate">{window.title}</span>
          </div>

          {/* Content Preview Placeholder */}
          <div className="p-2 flex items-center justify-center h-[calc(100%-16px)] overflow-hidden">
            {window.appType === 'preview' && window.props?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={window.props.url} alt="preview" className="w-full h-full object-contain opacity-80" />
            ) : window.appType === 'finder' && window.appState?.currentPath ? (
              <div className="flex flex-col items-center justify-center gap-1">
                <Folder className="w-6 h-6 text-blue-400/80" />
                <span className="text-[8px] text-white/60 truncate max-w-full px-1">
                  {window.appState.currentPath[window.appState.currentPath.length - 1]}
                </span>
              </div>
            ) : (
              <div className="text-white/20 text-xs capitalize">{window.appType}</div>
            )}
          </div>

          {/* Close Button (Visible on Hover) */}
          <button
            className="absolute top-1 right-1 p-1 rounded-full bg-red-500/80 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
            onClick={(e) => {
              e.stopPropagation();
              onClose(window.id);
            }}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </motion.div>
  );
};

const DockSettings = () => {
  const { dockPosition, setDockPosition } = useWindowStore();

  return (
    <div className="w-64 p-4 bg-white/80 dark:bg-black/80 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl">
      <div className="space-y-3">
        <div className="text-sm font-semibold mb-3">Dock Position</div>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => setDockPosition('left')}
            className={cn(
              "flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all hover:bg-white/10",
              dockPosition === 'left' ? "border-blue-500 bg-blue-500/20" : "border-white/20"
            )}
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-xs">Left</span>
          </button>
          <button
            onClick={() => setDockPosition('bottom')}
            className={cn(
              "flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all hover:bg-white/10",
              dockPosition === 'bottom' ? "border-blue-500 bg-blue-500/20" : "border-white/20"
            )}
          >
            <ArrowDown className="w-5 h-5" />
            <span className="text-xs">Bottom</span>
          </button>
          <button
            onClick={() => setDockPosition('right')}
            className={cn(
              "flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all hover:bg-white/10",
              dockPosition === 'right' ? "border-blue-500 bg-blue-500/20" : "border-white/20"
            )}
          >
            <ArrowRight className="w-5 h-5" />
            <span className="text-xs">Right</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const DockItem = ({ mouseX, icon: Icon, label, appType, isOpen, windows, onClick, onRightClick, onCloseWindow, onFocusWindow }: DockItemProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const widthSync = useTransform(distance, [-150, 0, 150], [40, 80, 40]);
  const width = useSpring(widthSync, { mass: 0.1, stiffness: 150, damping: 12 });

  const appWindows = windows.filter(w => w.appType === appType);

  return (
    <div
      className="relative flex flex-col items-center"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <AnimatePresence>
        {isHovered && appWindows.length > 0 && (
          <DockPreview
            windows={appWindows}
            onClose={onCloseWindow}
            onFocus={onFocusWindow}
          />
        )}
      </AnimatePresence>

      <Tooltip.Provider>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <motion.div
              ref={ref}
              style={{ width }}
              className="aspect-square rounded-xl bg-white/10 border border-white/20 backdrop-blur-md flex items-center justify-center cursor-pointer hover:bg-white/20 transition-colors relative z-10"
              onClick={onClick}
              onContextMenu={(e) => {
                e.preventDefault();
                onRightClick();
              }}
              whileTap={{ scale: 0.9 }}
              data-context-type="dock-icon"
              data-context-id={appType}
            >
              <Icon className="w-1/2 h-1/2 text-white" />
              {isOpen && (
                <div className="absolute -bottom-2 w-1 h-1 rounded-full bg-white/80 shadow-[0_0_4px_rgba(255,255,255,0.5)]" />
              )}
            </motion.div>
          </Tooltip.Trigger>
          {!isHovered && (
            <Tooltip.Portal>
              <Tooltip.Content
                className="px-2 py-1 text-xs font-medium text-white bg-black/50 backdrop-blur-md rounded border border-white/10 mb-2 z-50"
                sideOffset={5}
              >
                {label}
                <Tooltip.Arrow className="fill-black/50" />
              </Tooltip.Content>
            </Tooltip.Portal>
          )}
        </Tooltip.Root>
      </Tooltip.Provider>
    </div>
  );
};

export const Dock = () => {
  const mouseX = useMotionValue(Infinity);
  const { openWindow, closeWindow, focusWindow, windows, dockPosition } = useWindowStore();
  const [isDockHovered, setIsDockHovered] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Check if any window is maximized (and not minimized)
  const isAnyMaximized = windows.some(w => w.isMaximized && !w.isMinimized);

  const apps = [
    { id: 'finder', label: 'Finder', icon: Folder, type: 'finder' as AppType },
    { id: 'launchpad', label: 'Launchpad', icon: LayoutGrid, type: 'launchpad' as AppType },
    { id: 'dashboard', label: 'Dashboard', icon: Activity, type: 'dashboard' as AppType },
    { id: 'photos', label: 'Photos', icon: ImageIcon, type: 'photos' as AppType },
    { id: 'docker', label: 'Docker', icon: Container, type: 'docker' as AppType },
    { id: 'terminal', label: 'Terminal', icon: Terminal, type: 'terminal' as AppType },
    { id: 'calculator', label: 'Calculator', icon: Calculator, type: 'calculator' as AppType },
  ];

  const settingsApps = [
    { id: 'settings', label: 'Settings', icon: Settings, type: 'settings' as AppType },
    { id: 'trash', label: 'Trash', icon: Trash2, type: 'trash' as AppType },
  ];

  const handleMouseMove = (e: MouseEvent) => {
    if (!dockRef.current) return;

    const dockRect = dockRef.current.getBoundingClientRect();
    const buffer = 50; // Buffer zone

    let isInDockArea = false;

    if (dockPosition === 'bottom') {
      isInDockArea = (
        e.clientY >= dockRect.top - buffer &&
        e.clientY <= window.innerHeight &&
        e.clientX >= dockRect.left &&
        e.clientX <= dockRect.right
      );
    } else if (dockPosition === 'left') {
      isInDockArea = (
        e.clientX >= 0 &&
        e.clientX <= dockRect.right + buffer &&
        e.clientY >= dockRect.top &&
        e.clientY <= dockRect.bottom
      );
    } else if (dockPosition === 'right') {
      isInDockArea = (
        e.clientX >= dockRect.left - buffer &&
        e.clientX <= window.innerWidth &&
        e.clientY >= dockRect.top &&
        e.clientY <= dockRect.bottom
      );
    }

    if (!isInDockArea && isDockHovered) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setIsDockHovered(false);
      }, 100);
    } else if (isInDockArea) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setIsDockHovered(true);
    }
  };

  React.useEffect(() => {
    if (isAnyMaximized) {
      window.addEventListener('mousemove', handleMouseMove);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }
  }, [isAnyMaximized, isDockHovered, dockPosition]);

  const getPositionClasses = () => {
    const baseClass = "fixed z-50 transition-all duration-300 ease-in-out";
    const hideOffset = "120px";

    if (dockPosition === 'left') {
      return cn(
        baseClass,
        "top-1/2 -translate-y-1/2",
        isAnyMaximized && !isDockHovered ? `left-[-${hideOffset}]` : "left-4"
      );
    } else if (dockPosition === 'right') {
      return cn(
        baseClass,
        "top-1/2 -translate-y-1/2",
        isAnyMaximized && !isDockHovered ? `right-[-${hideOffset}]` : "right-4"
      );
    } else {
      return cn(
        baseClass,
        "left-1/2 -translate-x-1/2",
        isAnyMaximized && !isDockHovered ? "bottom-[-100px]" : "bottom-4"
      );
    }
  };

  const getDockContainerClasses = () => {
    if (dockPosition === 'left' || dockPosition === 'right') {
      return "flex-col w-16 py-4 px-3";
    }
    return "h-16 pb-3 px-4";
  };

  const getTriggerZone = () => {
    const zoneClass = "fixed z-40 transition-all";
    const activeSize = isAnyMaximized ? "6" : "0";

    if (dockPosition === 'left') {
      return (
        <div
          className={cn(zoneClass, `left-0 top-0 h-full w-${activeSize}`, !isAnyMaximized && "pointer-events-none")}
          onMouseEnter={() => setIsDockHovered(true)}
        />
      );
    } else if (dockPosition === 'right') {
      return (
        <div
          className={cn(zoneClass, `right-0 top-0 h-full w-${activeSize}`, !isAnyMaximized && "pointer-events-none")}
          onMouseEnter={() => setIsDockHovered(true)}
        />
      );
    } else {
      return (
        <div
          className={cn(zoneClass, `bottom-0 left-0 w-full h-${activeSize}`, !isAnyMaximized && "pointer-events-none")}
          onMouseEnter={() => setIsDockHovered(true)}
        />
      );
    }
  };

  return (
    <>
      {getTriggerZone()}

      <div
        ref={dockRef}
        className={getPositionClasses()}
        onMouseEnter={() => {
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setIsDockHovered(true);
        }}
        onMouseLeave={(e) => {
          const rect = dockRef.current?.getBoundingClientRect();
          if (!rect) return;

          let shouldHide = false;
          if (dockPosition === 'bottom') {
            shouldHide = e.clientY > rect.bottom;
          } else if (dockPosition === 'left') {
            shouldHide = e.clientX > rect.right;
          } else if (dockPosition === 'right') {
            shouldHide = e.clientX < rect.left;
          }

          if (shouldHide) {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            timeoutRef.current = setTimeout(() => {
              setIsDockHovered(false);
            }, 100);
          }
        }}
      >
        <motion.div
          onMouseMove={(e) => mouseX.set(dockPosition === 'bottom' ? e.pageX : e.pageY)}
          onMouseLeave={() => mouseX.set(Infinity)}
          className={cn(
            "flex items-end gap-4 rounded-2xl bg-white/10 dark:bg-black/20 border border-white/20 dark:border-white/10 backdrop-blur-xl shadow-2xl",
            getDockContainerClasses()
          )}
        >
          {apps.map((app) => {
            const appWindows = windows.filter(w => w.appType === app.type);
            const multiInstanceApps = ['finder', 'terminal', 'preview', 'photos'];
            const canMultiInstance = multiInstanceApps.includes(app.type);

            return (
              <DockItem
                key={app.id}
                mouseX={mouseX}
                icon={app.icon}
                label={app.label}
                appType={app.type}
                isOpen={appWindows.length > 0}
                windows={windows}
                onClick={() => {
                  // Windows-style: left click focuses if window exists, opens new if none
                  if (appWindows.length > 0) {
                    // Find the frontmost (highest zIndex) window of this type
                    const frontWindow = appWindows.reduce((prev, curr) =>
                      prev.zIndex > curr.zIndex ? prev : curr
                    );
                    focusWindow(frontWindow.id);
                  } else {
                    openWindow(app.type);
                  }
                }}
                onRightClick={() => {
                  // Right click: always open new window for multi-instance apps
                  if (canMultiInstance) {
                    openWindow(app.type);
                  }
                }}
                onCloseWindow={closeWindow}
                onFocusWindow={focusWindow}
              />
            );
          })}

          {/* Separator */}
          <div className={cn(
            "bg-white/20",
            dockPosition === 'bottom' ? "w-[1px] h-12" : "h-[1px] w-12"
          )} />

          {/* Settings Apps with Popover for Settings */}
          {settingsApps.map((app) => (
            app.id === 'settings' ? (
              <Popover.Root key={app.id} open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                <Popover.Trigger asChild>
                  <div>
                    <DockItem
                      mouseX={mouseX}
                      icon={app.icon}
                      label={app.label}
                      appType={app.type}
                      isOpen={windows.some(w => w.appType === app.type)}
                      windows={windows}
                      onClick={() => setIsSettingsOpen(true)}
                      onRightClick={() => setIsSettingsOpen(true)}
                      onCloseWindow={closeWindow}
                      onFocusWindow={focusWindow}
                    />
                  </div>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content
                    side={dockPosition === 'bottom' ? 'top' : dockPosition === 'left' ? 'right' : 'left'}
                    align="center"
                    sideOffset={10}
                    className="z-[60]"
                  >
                    <DockSettings />
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            ) : (
              <DockItem
                key={app.id}
                mouseX={mouseX}
                icon={app.icon}
                label={app.label}
                appType={app.type}
                isOpen={windows.some(w => w.appType === app.type)}
                windows={windows}
                onClick={() => {
                  const appWindows = windows.filter(w => w.appType === app.type);
                  if (appWindows.length > 0) {
                    const frontWindow = appWindows.reduce((prev, curr) =>
                      prev.zIndex > curr.zIndex ? prev : curr
                    );
                    focusWindow(frontWindow.id);
                  } else {
                    openWindow(app.type);
                  }
                }}
                onRightClick={() => openWindow(app.type)}
                onCloseWindow={closeWindow}
                onFocusWindow={focusWindow}
              />
            )
          ))}
        </motion.div>
      </div>
    </>
  );
};
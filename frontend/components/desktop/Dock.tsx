'use client';

import React, { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform, MotionValue } from 'framer-motion';
import { 
  Folder, 
  LayoutGrid, 
  Image as ImageIcon, 
  Container, 
  Settings, 
  Trash2, 
  Calculator, 
  Terminal,
  Activity
} from 'lucide-react';
import { useWindowStore, AppType } from '@/store/window-store';
import { cn } from '@/lib/utils';
import * as Tooltip from '@radix-ui/react-tooltip';

interface DockItemProps {
  mouseX: MotionValue;
  icon: React.ElementType;
  label: string;
  appType: AppType;
  onClick: () => void;
}

const DockItem = ({ mouseX, icon: Icon, label, appType, onClick }: DockItemProps) => {
  const ref = useRef<HTMLDivElement>(null);

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const widthSync = useTransform(distance, [-150, 0, 150], [40, 80, 40]);
  const width = useSpring(widthSync, { mass: 0.1, stiffness: 150, damping: 12 });

  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <motion.div
            ref={ref}
            style={{ width }}
            className="aspect-square rounded-xl bg-white/10 border border-white/20 backdrop-blur-md flex items-center justify-center cursor-pointer hover:bg-white/20 transition-colors"
            onClick={onClick}
            whileTap={{ scale: 0.9 }}
          >
            <Icon className="w-1/2 h-1/2 text-white" />
          </motion.div>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content 
            className="px-2 py-1 text-xs font-medium text-white bg-black/50 backdrop-blur-md rounded border border-white/10 mb-2"
            sideOffset={5}
          >
            {label}
            <Tooltip.Arrow className="fill-black/50" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
};

export const Dock = () => {
  const mouseX = useMotionValue(Infinity);
  const { openWindow } = useWindowStore();

  const apps = [
    { id: 'finder', label: 'Finder', icon: Folder, type: 'finder' as AppType },
    { id: 'launchpad', label: 'Launchpad', icon: LayoutGrid, type: 'launchpad' as AppType },
    { id: 'dashboard', label: 'Dashboard', icon: Activity, type: 'dashboard' as AppType },
    { id: 'photos', label: 'Photos', icon: ImageIcon, type: 'photos' as AppType },
    { id: 'docker', label: 'Docker', icon: Container, type: 'docker' as AppType },
    { id: 'terminal', label: 'Terminal', icon: Terminal, type: 'terminal' as AppType },
    { id: 'calculator', label: 'Calculator', icon: Calculator, type: 'calculator' as AppType },
    { id: 'settings', label: 'Settings', icon: Settings, type: 'settings' as AppType },
    { id: 'trash', label: 'Trash', icon: Trash2, type: 'trash' as AppType },
  ];

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <motion.div
        onMouseMove={(e) => mouseX.set(e.pageX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        className="flex h-16 items-end gap-4 rounded-2xl bg-white/10 border border-white/20 px-4 pb-3 backdrop-blur-md"
      >
        {apps.map((app) => (
          <DockItem
            key={app.id}
            mouseX={mouseX}
            icon={app.icon}
            label={app.label}
            appType={app.type}
            onClick={() => openWindow(app.type)}
          />
        ))}
      </motion.div>
    </div>
  );
};
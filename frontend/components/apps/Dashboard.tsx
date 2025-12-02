'use client';

import React from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';
import { Cpu, HardDrive, Activity, Server } from 'lucide-react';
import { cn } from '@/lib/utils';

const data = [
  { name: '00:00', cpu: 40, ram: 24 },
  { name: '00:05', cpu: 30, ram: 13 },
  { name: '00:10', cpu: 20, ram: 98 },
  { name: '00:15', cpu: 27, ram: 39 },
  { name: '00:20', cpu: 18, ram: 48 },
  { name: '00:25', cpu: 23, ram: 38 },
  { name: '00:30', cpu: 34, ram: 43 },
];

const Widget = ({ title, icon: Icon, children, className }: { title: string, icon: React.ElementType, children: React.ReactNode, className?: string }) => (
  <div className={cn("bg-white/10 dark:bg-black/20 backdrop-blur-md border border-white/10 rounded-xl p-4 flex flex-col", className)}>
    <div className="flex items-center gap-2 mb-4 text-gray-700 dark:text-gray-200">
      <Icon className="w-5 h-5" />
      <span className="font-medium">{title}</span>
    </div>
    <div className="flex-1 min-h-0">
      {children}
    </div>
  </div>
);

export const Dashboard = () => {
  return (
    <div className="h-full p-6 overflow-auto bg-white/50 dark:bg-black/50 backdrop-blur-xl">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 h-full max-h-[800px]">
        {/* CPU Usage */}
        <Widget title="CPU Usage" icon={Cpu} className="col-span-2 row-span-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" />
              <YAxis stroke="rgba(255,255,255,0.5)" />
              <Tooltip 
                contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px' }}
                itemStyle={{ color: '#fff' }}
              />
              <Area type="monotone" dataKey="cpu" stroke="#3b82f6" fillOpacity={1} fill="url(#colorCpu)" />
            </AreaChart>
          </ResponsiveContainer>
        </Widget>

        {/* Storage */}
        <Widget title="Storage" icon={HardDrive} className="col-span-1 row-span-1">
          <div className="flex flex-col gap-4 h-full justify-center">
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-600 dark:text-gray-300">
                <span>Macintosh HD</span>
                <span>450 GB / 1 TB</span>
              </div>
              <div className="h-2 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 w-[45%]" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-600 dark:text-gray-300">
                <span>Koimsurai NAS</span>
                <span>2.4 TB / 8 TB</span>
              </div>
              <div className="h-2 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 w-[30%]" />
              </div>
            </div>
          </div>
        </Widget>

        {/* RAM Usage */}
        <Widget title="Memory Usage" icon={Activity} className="col-span-1 row-span-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" />
              <Tooltip 
                cursor={{fill: 'rgba(255,255,255,0.1)'}}
                contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', border: 'none', borderRadius: '8px' }}
                itemStyle={{ color: '#fff' }}
              />
              <Bar dataKey="ram" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Widget>

        {/* Docker Containers */}
        <Widget title="Docker Containers" icon={Server} className="col-span-2 row-span-1">
          <div className="grid grid-cols-2 gap-4">
            {[
              { name: 'plex-server', status: 'running', cpu: '12%', ram: '1.2GB' },
              { name: 'home-assistant', status: 'running', cpu: '5%', ram: '450MB' },
              { name: 'pi-hole', status: 'running', cpu: '1%', ram: '120MB' },
              { name: 'nextcloud', status: 'stopped', cpu: '0%', ram: '0MB' },
            ].map((container, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-black/5 dark:bg-white/5 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className={cn("w-2 h-2 rounded-full", container.status === 'running' ? "bg-green-500" : "bg-red-500")} />
                  <span className="font-medium text-gray-700 dark:text-gray-200">{container.name}</span>
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  CPU: {container.cpu} | RAM: {container.ram}
                </div>
              </div>
            ))}
          </div>
        </Widget>
      </div>
    </div>
  );
};
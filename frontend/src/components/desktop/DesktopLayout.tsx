'use client';

import React from 'react';
import { TopBar } from './TopBar';
import { WindowContainer } from './WindowContainer';
import { UploadStatus } from './UploadStatus';

interface DesktopLayoutProps {
  children?: React.ReactNode;
}

export const DesktopLayout = ({ children }: DesktopLayoutProps) => {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-cover bg-center" 
         style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1477346611705-65d1883cee1e?q=80&w=2070&auto=format&fit=crop)' }}>
      {/* Overlay for better contrast */}
      <div className="absolute inset-0 bg-black/20" />
      
      <TopBar />
      
      <main className="relative w-full h-full pt-8 pb-20">
        <WindowContainer />
        {children}
        <UploadStatus />
      </main>
    </div>
  );
};
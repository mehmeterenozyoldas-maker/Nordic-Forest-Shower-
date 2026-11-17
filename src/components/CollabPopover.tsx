import React, { useState } from 'react';
import { Check, Copy, Users, X } from 'lucide-react';
import { CollabState } from '../types/simulation';

interface CollabPopoverProps {
  open: boolean;
  onClose: () => void;
  collab: CollabState;
  defaultVisitorName?: string;
  onJoinRoom: (roomId: string, name: string) => void;
  onLeaveRoom: () => void;
}

export const CollabPopover: React.FC<CollabPopoverProps> = ({
  open,
  onClose,
  collab,
  defaultVisitorName,
  onJoinRoom,
  onLeaveRoom,
}) => {
  const [roomInput, setRoomInput] = useState(collab.roomId || 'fjord-hall');
  const [nameInput, setNameInput] = useState(defaultVisitorName || collab.selfName || 'Guest Visitor');
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const isConnected = collab.status === 'connected' || collab.status === 'connecting';

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    onJoinRoom(roomInput, nameInput);
  };

  const handleCopyInvite = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', collab.roomId || roomInput);
    void navigator.clipboard?.writeText(url.toString());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      aria-label="Collaborative exhibition room"
      className="fixed right-6 top-20 z-40 w-80 overflow-hidden rounded-lg border border-white/15 bg-stone-950/95 p-4 shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-cyan-300" />
          <h3 className="font-display text-lg font-semibold text-stone-50">
            Shared Exhibition Room
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close collaboration panel"
          className="rounded p-1 text-stone-400 hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 space-y-3">
        <form onSubmit={handleJoin} className="space-y-2.5">
          <label className="block space-y-1">
            <span className="text-[11px] text-stone-400">Room Code</span>
            <input
              type="text"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              placeholder="fjord-hall"
              className="w-full rounded border border-white/15 bg-black px-2.5 py-1.5 font-mono-tabular text-xs text-stone-100 focus:border-cyan-300 focus:outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[11px] text-stone-400">Your Visitor Name</span>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Guest Visitor"
              maxLength={32}
              className="w-full rounded border border-white/15 bg-black px-2.5 py-1.5 text-xs text-stone-100 focus:border-cyan-300 focus:outline-none"
            />
          </label>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              className="flex-1 rounded bg-cyan-300 px-3 py-1.5 text-xs font-semibold text-stone-950 hover:bg-cyan-200"
            >
              {isConnected ? 'Switch / Update' : 'Join Live Room'}
            </button>
            {isConnected && (
              <button
                type="button"
                onClick={onLeaveRoom}
                className="rounded border border-white/15 px-3 py-1.5 text-xs text-stone-300 hover:border-white/35 hover:text-white"
              >
                Leave
              </button>
            )}
          </div>
        </form>

        {collab.error && <p className="text-[11px] text-red-300">{collab.error}</p>}

        {isConnected && (
          <div className="space-y-2 border-t border-white/10 pt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-stone-300">
                Room <span className="font-mono-tabular text-cyan-200">{collab.roomId}</span> ·{' '}
                {collab.visitors.length} present
              </span>
              <button
                type="button"
                onClick={handleCopyInvite}
                className="inline-flex items-center gap-1 text-[11px] text-cyan-300 hover:text-cyan-200"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                <span>{copied ? 'Copied' : 'Invite'}</span>
              </button>
            </div>

            <div className="max-h-28 space-y-1 overflow-y-auto">
              {collab.visitors.map((v) => (
                <div
                  key={v.clientId}
                  className="flex items-center justify-between rounded bg-black/50 px-2.5 py-1 text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: v.color }}
                    />
                    <span className="truncate text-stone-200">
                      {v.name}
                      {v.clientId === collab.selfId ? ' (You)' : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

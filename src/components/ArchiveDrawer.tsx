import React, { useState } from 'react';
import {
  Check,
  Copy,
  Heart,
  LogOut,
  Plus,
  Search,
  Trash2,
  Trees,
  User,
  X,
} from 'lucide-react';
import { CuratorProfile, ForestPlate } from '../types/simulation';

interface ArchiveDrawerProps {
  open: boolean;
  onClose: () => void;
  curator: CuratorProfile | null;
  plates: ForestPlate[];
  loading: boolean;
  error: string | null;
  scope: 'gallery' | 'mine';
  sort: 'recent' | 'popular';
  searchQuery: string;
  plantedCount: number;
  onChangeScope: (scope: 'gallery' | 'mine') => void;
  onChangeSort: (sort: 'recent' | 'popular') => void;
  onChangeSearch: (q: string) => void;
  onSignIn: (displayName: string, pin: string) => Promise<void>;
  onSignOut: () => void;
  onPublish: (title: string, notes: string, visibility: 'public' | 'unlisted') => Promise<ForestPlate | null>;
  onLoadPlate: (plate: ForestPlate) => void;
  onAppreciate: (id: string) => Promise<void>;
  onDeletePlate: (id: string) => Promise<void>;
}

export const ArchiveDrawer: React.FC<ArchiveDrawerProps> = ({
  open,
  onClose,
  curator,
  plates,
  loading,
  error,
  scope,
  sort,
  searchQuery,
  plantedCount,
  onChangeScope,
  onChangeSort,
  onChangeSearch,
  onSignIn,
  onSignOut,
  onPublish,
  onLoadPlate,
  onAppreciate,
  onDeletePlate,
}) => {
  const [nameInput, setNameInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [saveOpen, setSaveOpen] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'unlisted'>('public');
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (!open) return null;

  const handleSignInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      await onSignIn(nameInput, pinInput);
      setNameInput('');
      setPinInput('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handlePublishSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPublishError(null);
    setPublishBusy(true);
    try {
      const created = await onPublish(titleInput, notesInput, visibility);
      if (created) {
        setTitleInput('');
        setNotesInput('');
        setSaveOpen(false);
      }
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Unable to publish plate.');
    } finally {
      setPublishBusy(false);
    }
  };

  const handleCopyShare = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('forest', id);
    void navigator.clipboard?.writeText(url.toString());
    setCopiedId(id);
    window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
  };

  return (
    <aside
      aria-label="Exhibition Forest Archive"
      className="fixed right-6 top-20 z-40 flex max-h-[calc(100vh-11rem)] w-[410px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-lg border border-white/15 bg-stone-950/95 shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-stone-50">
            Forest Exhibition Archive
          </h2>
          <p className="mt-0.5 text-xs text-stone-400">
            Save, browse, and restore community forest plates
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close archive drawer"
          className="rounded p-1.5 text-stone-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {/* Curator Profile / Sign-In Strip */}
        <section className="rounded-md border border-white/10 bg-black/50 p-3.5">
          {curator ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-medium text-stone-100">
                  <User className="h-3.5 w-3.5 text-cyan-300" />
                  <span className="truncate">{curator.displayName}</span>
                </div>
                <p className="mt-0.5 font-mono-tabular text-[11px] text-stone-400">
                  @{curator.handle} · {plantedCount} planted in scene
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSaveOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1 rounded border border-emerald-400/40 bg-emerald-950/60 px-2.5 py-1.5 text-xs font-medium text-emerald-100 whitespace-nowrap hover:bg-emerald-900/70"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{saveOpen ? 'Cancel' : 'Save Plate'}</span>
                </button>
                <button
                  type="button"
                  onClick={onSignOut}
                  title="Sign out curator"
                  className="rounded border border-white/15 p-1.5 text-stone-400 hover:border-white/30 hover:text-white"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSignInSubmit(e)} className="space-y-2.5">
              <p className="text-xs font-medium text-stone-200">
                Sign in as Curator to publish & archive forests
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  required
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Curator name"
                  className="min-w-0 flex-1 rounded border border-white/15 bg-black px-2.5 py-1.5 text-xs text-stone-100 placeholder-stone-500 focus:border-cyan-300 focus:outline-none"
                />
                <input
                  type="password"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="PIN"
                  maxLength={12}
                  className="w-20 rounded border border-white/15 bg-black px-2.5 py-1.5 font-mono-tabular text-xs text-stone-100 placeholder-stone-500 focus:border-cyan-300 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={authBusy}
                  className="rounded bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-950 whitespace-nowrap hover:bg-white disabled:opacity-50"
                >
                  {authBusy ? 'Joining...' : 'Sign In'}
                </button>
              </div>
              {authError && <p className="text-[11px] text-red-300">{authError}</p>}
            </form>
          )}
        </section>

        {/* Publish Current Forest Form */}
        {curator && saveOpen && (
          <form
            onSubmit={(e) => void handlePublishSubmit(e)}
            className="space-y-3 rounded-md border border-emerald-400/30 bg-emerald-950/20 p-3.5"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-emerald-100">Archive Current Forest</span>
              <span className="font-mono-tabular text-stone-400">{plantedCount} planted trees</span>
            </div>
            <input
              type="text"
              required
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="Plate title (e.g., Solstice Pine Clearing)"
              maxLength={80}
              className="w-full rounded border border-white/15 bg-black px-2.5 py-1.5 text-xs text-stone-100 placeholder-stone-500 focus:border-emerald-300 focus:outline-none"
            />
            <textarea
              value={notesInput}
              onChange={(e) => setNotesInput(e.target.value)}
              placeholder="Curatorial notes on season, lighting, or wind..."
              maxLength={320}
              rows={2}
              className="w-full rounded border border-white/15 bg-black px-2.5 py-1.5 text-xs text-stone-100 placeholder-stone-500 focus:border-emerald-300 focus:outline-none"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 rounded border border-white/10 bg-black p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setVisibility('public')}
                  className={`rounded px-2 py-1 ${
                    visibility === 'public'
                      ? 'bg-stone-100 font-semibold text-stone-950'
                      : 'text-stone-300'
                  }`}
                >
                  Public Gallery
                </button>
                <button
                  type="button"
                  onClick={() => setVisibility('unlisted')}
                  className={`rounded px-2 py-1 ${
                    visibility === 'unlisted'
                      ? 'bg-stone-100 font-semibold text-stone-950'
                      : 'text-stone-300'
                  }`}
                >
                  Unlisted Link
                </button>
              </div>
              <button
                type="submit"
                disabled={publishBusy}
                className="rounded bg-emerald-300 px-3 py-1.5 text-xs font-semibold text-stone-950 whitespace-nowrap hover:bg-emerald-200 disabled:opacity-50"
              >
                {publishBusy ? 'Archiving...' : 'Publish Plate'}
              </button>
            </div>
            {publishError && <p className="text-[11px] text-red-300">{publishError}</p>}
          </form>
        )}

        {/* Filter & Search Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 rounded border border-white/10 bg-black p-0.5">
              <button
                type="button"
                onClick={() => onChangeScope('gallery')}
                className={`rounded px-2.5 py-1 text-xs whitespace-nowrap ${
                  scope === 'gallery'
                    ? 'bg-stone-100 font-semibold text-stone-950'
                    : 'text-stone-300 hover:text-white'
                }`}
              >
                Exhibition Gallery
              </button>
              <button
                type="button"
                onClick={() => onChangeScope('mine')}
                className={`rounded px-2.5 py-1 text-xs whitespace-nowrap ${
                  scope === 'mine'
                    ? 'bg-stone-100 font-semibold text-stone-950'
                    : 'text-stone-300 hover:text-white'
                }`}
              >
                My Archive
              </button>
            </div>

            <select
              aria-label="Sort archive plates"
              value={sort}
              onChange={(e) => onChangeSort(e.target.value as 'recent' | 'popular')}
              className="rounded border border-white/15 bg-black px-2 py-1 text-xs text-stone-200 focus:outline-none"
            >
              <option value="recent">Newest</option>
              <option value="popular">Most Appreciated</option>
            </select>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-stone-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onChangeSearch(e.target.value)}
              placeholder="Search title, curator, or accession code..."
              className="w-full rounded border border-white/15 bg-black py-1.5 pl-8 pr-3 text-xs text-stone-100 placeholder-stone-500 focus:border-cyan-300 focus:outline-none"
            />
          </div>
        </div>

        {/* Plate Cards */}
        {error && (
          <p className="rounded border border-red-400/30 bg-red-950/30 p-2.5 text-xs text-red-200">
            {error}
          </p>
        )}

        {loading ? (
          <p className="py-6 text-center text-xs text-stone-400">Loading archive plates...</p>
        ) : plates.length === 0 ? (
          <div className="rounded border border-white/10 bg-black/40 p-5 text-center text-xs text-stone-400">
            {scope === 'mine' && !curator
              ? 'Sign in above to view your personal saved forest plates.'
              : 'No archived plates match this filter yet.'}
          </div>
        ) : (
          <div className="space-y-3">
            {plates.map((plate) => {
              const isOwner = curator && plate.curatorId === curator.id;
              return (
                <article
                  key={plate.id}
                  className="overflow-hidden rounded-md border border-white/12 bg-black/60"
                >
                  {plate.thumbnailDataUrl ? (
                    <img
                      src={plate.thumbnailDataUrl}
                      alt={plate.title}
                      className="h-32 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-24 w-full items-center justify-between bg-stone-900/90 px-4">
                      <span className="font-mono-tabular text-xs text-stone-400">
                        {plate.accessionCode}
                      </span>
                      <Trees className="h-5 w-5 text-stone-600" />
                    </div>
                  )}

                  <div className="space-y-2 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono-tabular text-[11px] text-stone-400">
                          {plate.accessionCode} · {plate.atmosphere.season} · {plate.plantedTrees.length} planted
                        </p>
                        <h3 className="font-display text-lg font-semibold leading-snug text-stone-50">
                          {plate.title}
                        </h3>
                        <p className="text-[11px] text-stone-400">by {plate.authorName}</p>
                      </div>
                    </div>

                    {plate.notes && (
                      <p className="text-xs leading-relaxed text-stone-300">{plate.notes}</p>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => onLoadPlate(plate)}
                        className="rounded bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-950 whitespace-nowrap transition-colors hover:bg-white"
                      >
                        Load Plate
                      </button>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void onAppreciate(plate.id)}
                          title="Appreciate plate"
                          className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1.5 font-mono-tabular text-xs text-stone-200 hover:border-white/35 hover:text-white"
                        >
                          <Heart className="h-3.5 w-3.5 text-rose-300" />
                          <span>{plate.likesCount}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleCopyShare(plate.id)}
                          title="Copy shareable exhibition link"
                          className="inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1.5 text-xs text-stone-200 hover:border-white/35 hover:text-white"
                        >
                          {copiedId === plate.id ? (
                            <Check className="h-3.5 w-3.5 text-emerald-300" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>

                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => void onDeletePlate(plate.id)}
                            title="Delete plate"
                            className="rounded border border-white/15 p-1.5 text-stone-400 hover:border-red-400/50 hover:text-red-300"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};

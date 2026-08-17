"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import { sitesApi, roomsApi, bedsApi, Site, Room, Bed, ApiError } from "@/lib/api";

export default function SiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const siteId = Number(id);
  const { token } = useAuth();
  const router = useRouter();

  const [site, setSite] = useState<Site | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);

  // Room form
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [roomFloor, setRoomFloor] = useState("0");
  const [roomError, setRoomError] = useState("");
  const [roomLoading, setRoomLoading] = useState(false);

  // Beds state: { [roomId]: Bed[] }
  const [beds, setBeds] = useState<Record<number, Bed[]>>({});
  const [expandedRooms, setExpandedRooms] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!token) return;
    Promise.all([
      sitesApi.get(token, siteId),
      roomsApi.list(token, siteId),
    ])
      .then(([s, r]) => { setSite(s); setRooms(r); })
      .catch(() => router.replace("/sites"))
      .finally(() => setLoading(false));
  }, [token, siteId, router]);

  async function handleCreateRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setRoomError("");
    setRoomLoading(true);
    try {
      const room = await roomsApi.create(token, siteId, { name: roomName, floor: Number(roomFloor) });
      setRooms((prev) => [...prev, room]);
      setRoomName("");
      setRoomFloor("0");
      setShowRoomForm(false);
    } catch (err) {
      setRoomError(err instanceof ApiError ? err.message : "Failed to create room");
    } finally {
      setRoomLoading(false);
    }
  }

  async function handleDeleteRoom(roomId: number) {
    if (!token || !confirm("Delete this room?")) return;
    try {
      await roomsApi.delete(token, siteId, roomId);
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
    } catch {
      alert("Failed to delete room");
    }
  }

  async function toggleRoom(roomId: number) {
    setExpandedRooms((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) { next.delete(roomId); return next; }
      next.add(roomId);
      return next;
    });
    if (!beds[roomId] && token) {
      const b = await bedsApi.list(token, siteId, roomId).catch(() => []);
      setBeds((prev) => ({ ...prev, [roomId]: b }));
    }
  }

  async function handleAddBed(roomId: number, name: string) {
    if (!token) return;
    const bed = await bedsApi.create(token, siteId, roomId, { name });
    setBeds((prev) => ({ ...prev, [roomId]: [...(prev[roomId] || []), bed] }));
  }

  async function handleDeleteBed(roomId: number, bedId: number) {
    if (!token || !confirm("Delete this bed?")) return;
    await bedsApi.delete(token, siteId, roomId, bedId);
    setBeds((prev) => ({ ...prev, [roomId]: prev[roomId].filter((b) => b.id !== bedId) }));
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2 text-sm text-stone-500">
        <Link href="/sites" className="hover:text-indigo-600">Sites</Link>
        <span>/</span>
        <span className="text-stone-800">{site?.name}</span>
      </div>

      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">{site?.name}</h1>
          {site?.address && <p className="mt-1 text-sm text-stone-500">{site.address}</p>}
          <Link
            href={`/sites/${siteId}/grid`}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition hover:bg-indigo-100"
          >
            <GridIcon className="h-4 w-4" />
            View occupancy grid
          </Link>
        </div>
        <button
          onClick={() => setShowRoomForm(true)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
        >
          + Add room
        </button>
      </div>

      {/* Room form */}
      {showRoomForm && (
        <div className="mb-6 rounded-xl bg-white p-5 shadow-sm ring-1 ring-stone-200">
          <h3 className="mb-3 text-sm font-semibold text-stone-900">New room</h3>
          {roomError && <div className="mb-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{roomError}</div>}
          <form onSubmit={handleCreateRoom} className="flex flex-wrap gap-2">
            <input
              required
              type="text"
              placeholder="Room name (e.g. 101)"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
            <input
              type="number"
              placeholder="Floor"
              value={roomFloor}
              onChange={(e) => setRoomFloor(e.target.value)}
              className="w-24 rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            />
            <button
              type="submit"
              disabled={roomLoading}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
            >
              {roomLoading ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => { setShowRoomForm(false); setRoomError(""); }}
              className="rounded-lg px-4 py-2 text-sm text-stone-500 transition hover:bg-stone-100"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {/* Rooms list */}
      {rooms.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-stone-200 py-16 text-center">
          <p className="text-sm text-stone-500">No rooms yet. Add one above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              beds={beds[room.id]}
              expanded={expandedRooms.has(room.id)}
              onToggle={() => toggleRoom(room.id)}
              onDelete={() => handleDeleteRoom(room.id)}
              onAddBed={(name) => handleAddBed(room.id, name)}
              onDeleteBed={(bedId) => handleDeleteBed(room.id, bedId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RoomCard({
  room,
  beds,
  expanded,
  onToggle,
  onDelete,
  onAddBed,
  onDeleteBed,
}: {
  room: Room;
  beds?: Bed[];
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onAddBed: (name: string) => void;
  onDeleteBed: (id: number) => void;
}) {
  const [bedName, setBedName] = useState("");
  const [addingBed, setAddingBed] = useState(false);

  async function submitBed(e: React.FormEvent) {
    e.preventDefault();
    if (!bedName.trim()) return;
    setAddingBed(true);
    await onAddBed(bedName.trim());
    setBedName("");
    setAddingBed(false);
  }

  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-stone-200">
      <div className="flex items-center justify-between px-5 py-4">
        <button
          className="flex flex-1 items-center gap-3 text-left"
          onClick={onToggle}
        >
          <ChevronIcon expanded={expanded} />
          <div>
            <span className="font-semibold text-stone-900">{room.name}</span>
            {room.floor > 0 && (
              <span className="ml-2 text-sm text-stone-400">Floor {room.floor}</span>
            )}
          </div>
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 text-stone-400 transition hover:bg-red-50 hover:text-red-500"
          title="Delete room"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-stone-100 px-5 py-4">
          {/* Beds */}
          {beds === undefined ? (
            <p className="text-sm text-stone-400">Loading…</p>
          ) : beds.length === 0 ? (
            <p className="mb-3 text-sm text-stone-400">No beds yet.</p>
          ) : (
            <div className="mb-3 flex flex-wrap gap-2">
              {beds.map((bed) => (
                <div
                  key={bed.id}
                  className="group flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1 text-sm text-stone-700"
                >
                  {bed.name}
                  <button
                    onClick={() => onDeleteBed(bed.id)}
                    className="ml-1 hidden text-stone-400 transition hover:text-red-500 group-hover:inline"
                    title="Remove bed"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add bed form */}
          <form onSubmit={submitBed} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Bed name (e.g. A, Lower)"
              value={bedName}
              onChange={(e) => setBedName(e.target.value)}
              className="rounded-lg border border-stone-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
            />
            <button
              type="submit"
              disabled={addingBed || !bedName.trim()}
              className="rounded-lg bg-stone-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-stone-700 disabled:opacity-50"
            >
              Add bed
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-stone-400 transition-transform ${expanded ? "rotate-90" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

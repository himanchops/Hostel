"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/auth";
import { sitesApi, roomsApi, bedsApi, Site, Room, Bed, ApiError } from "@/lib/api";
import {
  Button,
  Card,
  DoorIcon,
  EmptyState,
  FormError,
  Input,
  PageHeader,
  Skeleton,
  useConfirm,
  useToast,
} from "@/components/ui";

export default function SiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const siteId = Number(id);
  const { token } = useAuth();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();

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
      toast.success(`Added room ${room.name}`);
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
    if (!token) return;
    const ok = await confirm({ title: "Delete this room?", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    try {
      await roomsApi.delete(token, siteId, roomId);
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
      toast.success("Room deleted");
    } catch {
      toast.error("Failed to delete room");
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
    try {
      const bed = await bedsApi.create(token, siteId, roomId, { name });
      setBeds((prev) => ({ ...prev, [roomId]: [...(prev[roomId] || []), bed] }));
      toast.success(`Added bed ${bed.name}`);
    } catch {
      toast.error("Failed to add the bed");
    }
  }

  async function handleDeleteBed(roomId: number, bedId: number) {
    if (!token) return;
    const ok = await confirm({ title: "Delete this bed?", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    try {
      await bedsApi.delete(token, siteId, roomId, bedId);
      setBeds((prev) => ({ ...prev, [roomId]: prev[roomId].filter((b) => b.id !== bedId) }));
      toast.success("Bed removed");
    } catch {
      toast.error("Failed to remove the bed");
    }
  }

  if (loading) {
    return (
      <div className="space-y-3 p-4 sm:p-6 lg:p-8">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <PageHeader
        breadcrumb={[{ label: "Sites", href: "/sites" }, { label: site?.name ?? "" }]}
        title={site?.name ?? ""}
        subtitle={site?.address ?? undefined}
        actions={<Button onClick={() => setShowRoomForm(true)}>+ Add room</Button>}
      />

      <Link
        href={`/sites/${siteId}/grid`}
        className="mb-6 inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition duration-150 ease-out hover:bg-indigo-100"
      >
        <GridIcon className="h-4 w-4" />
        View occupancy grid
      </Link>

      {/* Room form */}
      {showRoomForm && (
        <Card title="New room" className="mb-6">
          <form onSubmit={handleCreateRoom} className="space-y-3">
            {roomError && <FormError>{roomError}</FormError>}
            <div className="flex flex-wrap items-start gap-2">
              <Input
                required
                type="text"
                placeholder="Room name (e.g. 101)"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                className="w-56"
              />
              <Input
                type="number"
                placeholder="Floor"
                value={roomFloor}
                onChange={(e) => setRoomFloor(e.target.value)}
                className="w-24"
              />
              <Button type="submit" loading={roomLoading}>
                {roomLoading ? "Adding…" : "Add"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setShowRoomForm(false); setRoomError(""); }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Rooms list */}
      {rooms.length === 0 ? (
        <EmptyState
          icon={<DoorIcon className="h-8 w-8" />}
          title="No rooms yet"
          message="Add rooms, then add the beds in each one. The grid fills in from there."
          action={<Button onClick={() => setShowRoomForm(true)}>+ Add room</Button>}
        />
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
    <Card padding="none">
      <div className="flex items-center justify-between px-4 py-3">
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
          className="rounded-lg p-1 text-stone-400 transition duration-150 ease-out hover:bg-red-50 hover:text-red-500"
          title="Delete room"
        >
          <TrashIcon className="h-4 w-4" />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-stone-100 px-4 py-3">
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
                    className="ml-1 hidden text-stone-400 transition duration-150 ease-out hover:text-red-500 group-hover:inline"
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
            <Input
              type="text"
              placeholder="Bed name (e.g. A, Lower)"
              value={bedName}
              onChange={(e) => setBedName(e.target.value)}
              className="w-56"
            />
            <Button type="submit" size="sm" loading={addingBed} disabled={!bedName.trim()}>
              Add bed
            </Button>
          </form>
        </div>
      )}
    </Card>
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
      className={`h-4 w-4 text-stone-400 transition-transform duration-150 ease-out ${expanded ? "rotate-90" : ""}`}
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

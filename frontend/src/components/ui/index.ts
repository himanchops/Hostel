/**
 * The component kit (design plan Phase B). Pages import from here:
 *
 *   import { Button, Card, Field, Input } from "@/components/ui";
 *
 * Rule of thumb: if a page is writing raw colour, radius or ring classNames,
 * the thing it is styling belongs in this directory instead.
 */
export { Button, buttonClasses } from "./Button";
export type { ButtonVariant, ButtonSize } from "./Button";
export { Card } from "./Card";
export { Field, Input, Select, Textarea, FileInput, FormError } from "./Field";
export { Avatar, EmptyAvatar, avatarColor, initials } from "./Avatar";
export { Badge, CountBadge } from "./Badge";
export { Banner } from "./Banner";
export type { BadgeTone } from "./Badge";
export { StatusPill, STATUS_STYLES } from "./StatusPill";
export { Drawer } from "./Drawer";
export { Modal } from "./Modal";
export { ConfirmProvider, useConfirm } from "./ConfirmDialog";
export type { ConfirmOptions } from "./ConfirmDialog";
export { EmptyState } from "./EmptyState";
export { PageHeader } from "./PageHeader";
export type { Crumb } from "./PageHeader";
export { Skeleton, SkeletonText, SkeletonCard } from "./Skeleton";
export * from "./icons";
export { ToastProvider, useToast } from "./Toast";

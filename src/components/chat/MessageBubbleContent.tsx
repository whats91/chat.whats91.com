'use client';

import { useState } from 'react';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { Badge } from '@/components/ui/badge';
import { resolveMessageForRendering } from '@/lib/messages/resolve-message-for-rendering';
import type { ContactData, Message } from '@/lib/types/chat';
import { cn } from '@/lib/utils';
import {
  ExternalLink,
  FileText,
  Image as ImageIcon,
  ListChecks,
  MapPin,
  MousePointerClick,
  Phone,
  SmilePlus,
  UserRound,
  Video,
  Volume2,
} from 'lucide-react';

interface MessageBubbleContentProps {
  message: Message;
  isOwn: boolean;
}

type JsonObject = Record<string, unknown>;

interface InteractiveButtonItem {
  id: string;
  title: string;
  description?: string;
}

interface InteractiveSection {
  title?: string;
  rows: InteractiveButtonItem[];
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRenderableMediaUrl(url: string | null | undefined): url is string {
  return !!url && /^(https?:\/\/|blob:|data:|\/(?!\/))/i.test(url);
}

function isMeaningfulText(text: string | null | undefined): text is string {
  return !!text && !!text.trim() && !/^\[[^\]]+\]$/.test(text.trim());
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatWhatsAppText(text: string): string {
  let safeText = escapeHtml(text);
  safeText = safeText.replace(/```([\s\S]+?)```/g, '<code class="rounded bg-black/10 px-1 py-0.5">$1</code>');
  safeText = safeText.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
  safeText = safeText.replace(/_([^_]+)_/g, '<em>$1</em>');
  safeText = safeText.replace(/~([^~]+)~/g, '<del>$1</del>');
  return safeText;
}

const STANDARD_MEDIA_CARD_CLASS = 'w-[min(20rem,calc(100vw-7rem))] max-w-full';
const STICKER_MEDIA_CARD_CLASS = 'w-[min(14rem,calc(100vw-9rem))] max-w-full';

function getPanelClass(isOwn: boolean): string {
  return cn(
    'rounded-md border p-3',
    isOwn ? 'border-primary-foreground/15 bg-primary-foreground/10' : 'border-border/70 bg-background/70'
  );
}

function getMutedTextClass(isOwn: boolean): string {
  return isOwn ? 'text-primary-foreground/70' : 'text-muted-foreground';
}

function getMessageCaption(content: string, caption: string | null): string | null {
  if (isMeaningfulText(caption)) return caption;
  if (isMeaningfulText(content)) return content;
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractButtons(buttons: unknown): InteractiveButtonItem[] {
  if (!Array.isArray(buttons)) return [];

  return buttons
    .map((button, index) => {
      const parsed = isObject(button) ? button : {};
      const reply = isObject(parsed.reply) ? parsed.reply : {};
      const id = getString(reply.id) || getString(parsed.id) || String(index);
      const title =
        getString(reply.title) ||
        getString(parsed.title) ||
        getString(parsed.text) ||
        getString(parsed.payload) ||
        `Button ${index + 1}`;

      return { id, title };
    })
    .filter((button) => !!button.title);
}

function extractInteractiveSections(action: unknown): InteractiveSection[] {
  const parsedAction = isObject(action) ? action : {};
  const sections = Array.isArray(parsedAction.sections) ? parsedAction.sections : [];

  return sections
    .map((section) => {
      const parsedSection = isObject(section) ? section : {};
      const rows = Array.isArray(parsedSection.rows) ? parsedSection.rows : [];

      const parsedRows = rows
        .map((row, index) => {
          const parsedRow = isObject(row) ? row : {};
          const id = getString(parsedRow.id) || String(index);
          const title = getString(parsedRow.title) || getString(parsedRow.id) || `Option ${index + 1}`;
          const description = getString(parsedRow.description) || undefined;
          return { id, title, description };
        })
        .filter((row) => !!row.title);

      return {
        title: getString(parsedSection.title) || undefined,
        rows: parsedRows,
      };
    })
    .filter((section) => section.rows.length > 0);
}

function RichText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div
      className={cn('text-sm whitespace-pre-wrap break-words leading-6', className)}
      dangerouslySetInnerHTML={{ __html: formatWhatsAppText(text) }}
    />
  );
}

function AttachmentFallback({
  icon: Icon,
  title,
  description,
  isOwn,
  className,
}: {
  icon: typeof FileText;
  title: string;
  description?: string | null;
  isOwn: boolean;
  className?: string;
}) {
  return (
    <div className={cn(getPanelClass(isOwn), className)}>
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-black/10 p-2">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium break-words">{title}</p>
          {description && (
            <p className={cn('mt-1 text-xs break-words', getMutedTextClass(isOwn))}>{description}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ImageContent({
  mediaUrl,
  caption,
  isOwn,
  sticker = false,
}: {
  mediaUrl: string | null;
  caption: string | null;
  isOwn: boolean;
  sticker?: boolean;
}) {
  if (!isRenderableMediaUrl(mediaUrl)) {
    return (
      <AttachmentFallback
        icon={ImageIcon}
        title={sticker ? 'Sticker' : 'Image'}
        description={mediaUrl || 'Media URL unavailable'}
        isOwn={isOwn}
        className={sticker ? STICKER_MEDIA_CARD_CLASS : STANDARD_MEDIA_CARD_CLASS}
      />
    );
  }

  return (
    <div className={cn('space-y-2', sticker ? STICKER_MEDIA_CARD_CLASS : STANDARD_MEDIA_CARD_CLASS)}>
      <div className="overflow-hidden rounded-md bg-black/10">
        <AspectRatio ratio={sticker ? 1 : 4 / 3}>
          <img
            src={mediaUrl}
            alt={caption || (sticker ? 'Sticker' : 'Image')}
            loading="lazy"
            className={cn(
              'h-full w-full',
              sticker ? 'object-contain p-2' : 'object-cover'
            )}
          />
        </AspectRatio>
      </div>
      {caption && <RichText text={caption} className="text-inherit" />}
    </div>
  );
}

function VideoContent({
  mediaUrl,
  caption,
  isOwn,
}: {
  mediaUrl: string | null;
  caption: string | null;
  isOwn: boolean;
}) {
  if (!isRenderableMediaUrl(mediaUrl)) {
    return (
      <AttachmentFallback
        icon={Video}
        title="Video"
        description={mediaUrl || 'Media URL unavailable'}
        isOwn={isOwn}
        className={STANDARD_MEDIA_CARD_CLASS}
      />
    );
  }

  return (
    <div className={cn('space-y-2', STANDARD_MEDIA_CARD_CLASS)}>
      <video src={mediaUrl} controls preload="metadata" className="max-h-[360px] w-full rounded-md bg-black" />
      {caption && <RichText text={caption} className="text-inherit" />}
    </div>
  );
}

function AudioContent({
  mediaUrl,
  label,
  isOwn,
}: {
  mediaUrl: string | null;
  label: string;
  isOwn: boolean;
}) {
  if (!isRenderableMediaUrl(mediaUrl)) {
    return (
      <AttachmentFallback
        icon={Volume2}
        title={label}
        description={mediaUrl || 'Media URL unavailable'}
        isOwn={isOwn}
        className={STANDARD_MEDIA_CARD_CLASS}
      />
    );
  }

  return (
    <div className={cn(getPanelClass(isOwn), STANDARD_MEDIA_CARD_CLASS)}>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Volume2 className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <audio controls preload="metadata" className="w-full min-w-[220px]" src={mediaUrl} />
    </div>
  );
}

function DocumentOpenButton({
  mediaUrl,
  isOwn,
  onError,
}: {
  mediaUrl: string;
  isOwn: boolean;
  onError: (message: string | null) => void;
}) {
  const [isOpening, setIsOpening] = useState(false);

  const handleOpen = async () => {
    if (isOpening) return;

    onError(null);

    const popup = window.open('', '_blank');
    if (popup) {
      popup.opener = null;
      popup.document.title = 'Opening document';
      popup.document.body.innerHTML =
        '<div style="font-family: sans-serif; padding: 16px; color: #444;">Opening document...</div>';
    }

    try {
      setIsOpening(true);

      const response = await fetch(mediaUrl, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Media request failed with status ${response.status}`);
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      if (popup) {
        popup.location.href = blobUrl;
      } else {
        window.open(blobUrl, '_blank', 'noopener,noreferrer');
      }

      window.setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 60_000);
    } catch (error) {
      if (popup) {
        popup.close();
      }

      console.error('Unable to open document blob', error);
      onError('Unable to open document right now');
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        void handleOpen();
      }}
      disabled={isOpening}
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium transition-opacity',
        isOpening && 'cursor-wait opacity-70',
        isOwn ? 'text-primary-foreground/90' : 'text-primary'
      )}
    >
      <ExternalLink className="h-3 w-3" />
      <span>{isOpening ? 'Opening...' : 'Open'}</span>
    </button>
  );
}

function DocumentContent({
  mediaUrl,
  filename,
  mimeType,
  caption,
  isOwn,
}: {
  mediaUrl: string | null;
  filename: string | null;
  mimeType: string | null;
  caption: string | null;
  isOwn: boolean;
}) {
  const canOpen = isRenderableMediaUrl(mediaUrl);
  const [openError, setOpenError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <div className={cn(getPanelClass(isOwn), STANDARD_MEDIA_CARD_CLASS)}>
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-black/10 p-2">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium break-words">{filename || 'Document'}</p>
            {mimeType && <p className={cn('mt-1 text-xs', getMutedTextClass(isOwn))}>{mimeType}</p>}
          </div>
          {canOpen && <DocumentOpenButton mediaUrl={mediaUrl} isOwn={isOwn} onError={setOpenError} />}
        </div>
        {openError && <p className={cn('mt-2 text-xs', getMutedTextClass(isOwn))}>{openError}</p>}
      </div>
      {caption && <RichText text={caption} className="text-inherit" />}
    </div>
  );
}

function LocationContent({
  latitude,
  longitude,
  name,
  address,
  isOwn,
}: {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  isOwn: boolean;
}) {
  const mapUrl = `https://maps.google.com/?q=${latitude},${longitude}`;

  return (
    <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="block">
      <div className={getPanelClass(isOwn)}>
        <div className="mb-3 flex h-24 items-center justify-center rounded-md bg-black/10">
          <MapPin className="h-7 w-7" />
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{name || 'Shared location'}</span>
            <ExternalLink className="h-3 w-3 opacity-70" />
          </div>
          {address && <p className={cn('text-xs break-words', getMutedTextClass(isOwn))}>{address}</p>}
          <p className={cn('text-xs', getMutedTextClass(isOwn))}>
            {latitude}, {longitude}
          </p>
        </div>
      </div>
    </a>
  );
}

function ContactContent({
  contacts,
  isOwn,
}: {
  contacts: ContactData[];
  isOwn: boolean;
}) {
  return (
    <div className="space-y-2">
      {contacts.slice(0, 2).map((contact, index) => {
        const phones = Array.isArray(contact.phones) ? contact.phones : [];
        const legacyName = isObject(contact.name)
          ? getString((contact.name as JsonObject).formatted_name)
          : null;
        const displayName =
          contact.name?.formattedName ||
          legacyName ||
          [contact.name?.firstName, contact.name?.lastName].filter(Boolean).join(' ') ||
          'Contact';

        return (
          <div key={`${displayName}-${index}`} className={getPanelClass(isOwn)}>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-black/10 p-2.5">
                <UserRound className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium break-words">{displayName}</p>
                {phones.slice(0, 2).map((phone, phoneIndex) => (
                  <div key={`${phone.phone || phone.wa_id || phoneIndex}`} className="mt-1 flex items-center gap-2">
                    <Phone className="h-3 w-3 opacity-70" />
                    <span className={cn('text-xs break-all', getMutedTextClass(isOwn))}>
                      {phone.phone || phone.wa_id || 'Unknown number'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InteractiveButtons({
  buttons,
  isOwn,
}: {
  buttons: InteractiveButtonItem[];
  isOwn: boolean;
}) {
  if (buttons.length === 0) return null;

  return (
    <div className="space-y-2">
      {buttons.map((button) => (
        <div key={button.id} className={getPanelClass(isOwn)}>
          <div className="flex items-start gap-2">
            <MousePointerClick className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
            <div className="min-w-0">
              <p className="text-sm font-medium break-words">{button.title}</p>
              {button.description && (
                <p className={cn('mt-1 text-xs break-words', getMutedTextClass(isOwn))}>{button.description}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function InteractiveListContent({
  buttonLabel,
  sections,
  isOwn,
}: {
  buttonLabel: string;
  sections: InteractiveSection[];
  isOwn: boolean;
}) {
  if (sections.length === 0) return null;

  return (
    <div className={getPanelClass(isOwn)}>
      <div className="mb-3 flex items-center gap-2 border-b border-current/10 pb-2">
        <ListChecks className="h-4 w-4 opacity-70" />
        <span className="text-sm font-medium">{buttonLabel}</span>
      </div>
      <div className="space-y-3">
        {sections.map((section, sectionIndex) => (
          <div key={`${section.title || 'section'}-${sectionIndex}`} className="space-y-2">
            {section.title && <p className={cn('text-[11px] font-semibold uppercase tracking-wide', getMutedTextClass(isOwn))}>{section.title}</p>}
            <div className="space-y-2">
              {section.rows.map((row) => (
                <div key={row.id} className="rounded-md bg-black/5 px-3 py-2">
                  <p className="text-sm font-medium break-words">{row.title}</p>
                  {row.description && (
                    <p className={cn('mt-1 text-xs break-words', getMutedTextClass(isOwn))}>{row.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReactionContent({
  emoji,
  isOwn,
}: {
  emoji: string;
  isOwn: boolean;
}) {
  return (
    <div
      className={cn(
        'inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-sm',
        isOwn ? 'border-primary-foreground/15 bg-primary-foreground/10' : 'border-border/70 bg-background/70'
      )}
    >
      <SmilePlus className="h-4 w-4 opacity-70" />
      <span className="text-lg leading-none">{emoji}</span>
    </div>
  );
}

function InteractiveContent({
  content,
  interactiveData,
  isOwn,
  showTemplateBadge = false,
}: {
  content: string;
  interactiveData: JsonObject | null;
  isOwn: boolean;
  showTemplateBadge?: boolean;
}) {
  if (!interactiveData) {
    return isMeaningfulText(content) ? <RichText text={content} className="text-inherit" /> : null;
  }

  const interactiveType = String(interactiveData.type || '').toLowerCase();
  const action = isObject(interactiveData.action) ? interactiveData.action : {};
  const replyButtons = extractButtons(action.buttons);
  const templateButtons = extractButtons(interactiveData.buttons);
  const sections = extractInteractiveSections(action);
  const buttonLabel = getString(action.button) || 'View options';
  const title =
    getString(interactiveData.title) ||
    getString(interactiveData.text) ||
    getString(interactiveData.payload) ||
    content;
  const description = getString(interactiveData.description);

  if (interactiveType === 'button_reply' || (interactiveType === 'button' && replyButtons.length === 0)) {
    return (
      <div className="space-y-2">
        {showTemplateBadge && <Badge variant="secondary" className="w-fit">Template</Badge>}
        {isMeaningfulText(content) && title !== content && <RichText text={content} className="text-inherit" />}
        {title && <InteractiveButtons buttons={[{ id: title, title }]} isOwn={isOwn} />}
      </div>
    );
  }

  if (interactiveType === 'list_reply') {
    return (
      <div className="space-y-2">
        {showTemplateBadge && <Badge variant="secondary" className="w-fit">Template</Badge>}
        {isMeaningfulText(content) && title !== content && <RichText text={content} className="text-inherit" />}
        {title && <InteractiveButtons buttons={[{ id: title, title, description: description || undefined }]} isOwn={isOwn} />}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {showTemplateBadge && <Badge variant="secondary" className="w-fit">Template</Badge>}
      {isMeaningfulText(content) && <RichText text={content} className="text-inherit" />}
      {interactiveType === 'list' && <InteractiveListContent buttonLabel={buttonLabel} sections={sections} isOwn={isOwn} />}
      {(interactiveType === 'template' || interactiveType === 'button') && (
        <InteractiveButtons buttons={replyButtons.length > 0 ? replyButtons : templateButtons} isOwn={isOwn} />
      )}
      {interactiveType === 'interactive' && replyButtons.length > 0 && (
        <InteractiveButtons buttons={replyButtons} isOwn={isOwn} />
      )}
    </div>
  );
}

export function MessageBubbleContent({ message, isOwn }: MessageBubbleContentProps) {
  const resolved = resolveMessageForRendering(message);
  const caption = getMessageCaption(resolved.content, resolved.mediaCaption);

  switch (resolved.type) {
    case 'image':
      return <ImageContent mediaUrl={resolved.mediaUrl} caption={caption} isOwn={isOwn} />;

    case 'sticker':
      return <ImageContent mediaUrl={resolved.mediaUrl} caption={null} isOwn={isOwn} sticker />;

    case 'video':
      return <VideoContent mediaUrl={resolved.mediaUrl} caption={caption} isOwn={isOwn} />;

    case 'audio':
      return <AudioContent mediaUrl={resolved.mediaUrl} label={resolved.mediaFilename || 'Audio message'} isOwn={isOwn} />;

    case 'document':
      return (
        <DocumentContent
          mediaUrl={resolved.mediaUrl}
          filename={resolved.mediaFilename}
          mimeType={resolved.mediaMimeType}
          caption={caption}
          isOwn={isOwn}
        />
      );

    case 'location': {
      const latitude = toNumber(resolved.locationData?.latitude);
      const longitude = toNumber(resolved.locationData?.longitude);

      if (latitude !== null && longitude !== null) {
        return (
          <LocationContent
            latitude={latitude}
            longitude={longitude}
            name={resolved.locationData?.name}
            address={resolved.locationData?.address}
            isOwn={isOwn}
          />
        );
      }

      return isMeaningfulText(resolved.content) ? (
        <RichText text={resolved.content} className="text-inherit" />
      ) : (
        <AttachmentFallback icon={MapPin} title="Location" description="Location details unavailable" isOwn={isOwn} />
      );
    }

    case 'contacts':
      return resolved.contactData && resolved.contactData.length > 0 ? (
        <ContactContent contacts={resolved.contactData} isOwn={isOwn} />
      ) : isMeaningfulText(resolved.content) ? (
        <RichText text={resolved.content} className="text-inherit" />
      ) : (
        <AttachmentFallback icon={UserRound} title="Contact" description="Contact details unavailable" isOwn={isOwn} />
      );

    case 'interactive':
    case 'button':
    case 'button_reply':
    case 'list_reply':
      return <InteractiveContent content={resolved.content} interactiveData={resolved.interactiveData} isOwn={isOwn} />;

    case 'template':
      return (
        <InteractiveContent
          content={resolved.content}
          interactiveData={resolved.interactiveData}
          isOwn={isOwn}
          showTemplateBadge
        />
      );

    case 'reaction':
      return <ReactionContent emoji={(resolved.reactionData?.emoji as string) || resolved.content || '👍'} isOwn={isOwn} />;

    case 'unknown':
      return resolved.mediaUrl ? (
        <AttachmentFallback
          icon={FileText}
          title={resolved.mediaFilename || 'Attachment'}
          description={resolved.mediaMimeType || resolved.mediaUrl}
          isOwn={isOwn}
          className={STANDARD_MEDIA_CARD_CLASS}
        />
      ) : isMeaningfulText(resolved.content) ? (
        <RichText text={resolved.content} className="text-inherit" />
      ) : (
        <AttachmentFallback
          icon={FileText}
          title="Message"
          description="Unsupported message payload"
          isOwn={isOwn}
          className={STANDARD_MEDIA_CARD_CLASS}
        />
      );

    case 'text':
    default:
      return isMeaningfulText(resolved.content) ? (
        <RichText text={resolved.content} className="text-inherit" />
      ) : (
        <AttachmentFallback
          icon={FileText}
          title="Message"
          description="No renderable text content"
          isOwn={isOwn}
          className={STANDARD_MEDIA_CARD_CLASS}
        />
      );
  }
}

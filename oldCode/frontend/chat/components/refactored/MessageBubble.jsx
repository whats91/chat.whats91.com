'use client';

import { memo, useState, useEffect } from 'react';
import { 
  Check, CheckCheck, Clock, AlertCircle, Image as ImageIcon, FileText,
  MapPin, User, Phone, Download, ListChecks, MousePointerClick, SmilePlus,
  Video, Mic
} from 'lucide-react';
import { resolveMessageForRendering } from '@/utils/whatsappPayloadUtils';
import axiosInstance from '@/lib/axios';

// Format time helper
const formatTime = (timestamp) => {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
};

// Get file extension icon
const getFileIcon = (filename, mimeType) => {
  const ext = filename?.split('.').pop()?.toLowerCase();
  if (mimeType?.includes('pdf')) return { icon: '📄', color: '#E74C3C' };
  if (mimeType?.includes('word') || ext === 'doc' || ext === 'docx') return { icon: '📝', color: '#3498DB' };
  if (mimeType?.includes('excel') || ext === 'xls' || ext === 'xlsx') return { icon: '📊', color: '#27AE60' };
  if (mimeType?.includes('powerpoint') || ext === 'ppt' || ext === 'pptx') return { icon: '📋', color: '#E67E22' };
  if (mimeType?.includes('zip') || ext === 'zip' || ext === 'rar') return { icon: '🗜️', color: '#9B59B6' };
  return { icon: '📄', color: '#667781' };
};

const MIME_EXTENSION_MAP = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'application/pdf': 'pdf'
};

const getAttachmentIconComponent = (type) => {
  switch (type) {
    case 'image':
    case 'sticker':
      return ImageIcon;
    case 'video':
      return Video;
    case 'audio':
      return Mic;
    default:
      return FileText;
  }
};

const getExtensionFromFilename = (filename = '') => {
  if (typeof filename !== 'string' || !filename.trim()) {
    return '';
  }

  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext || ext === filename.toLowerCase()) {
    return '';
  }
  return ext;
};

const getExtensionFromMimeType = (mimeType = '') => {
  if (typeof mimeType !== 'string' || !mimeType.trim()) {
    return '';
  }

  const normalized = mimeType.toLowerCase().split(';')[0];
  if (!normalized) return '';
  if (MIME_EXTENSION_MAP[normalized]) return MIME_EXTENSION_MAP[normalized];

  const rawExt = normalized.split('/')[1];
  if (!rawExt) return '';
  return rawExt === 'jpeg' ? 'jpg' : rawExt.replace(/^x-/, '');
};

const buildConversationFilename = ({
  conversationId,
  originalFilename,
  mimeType,
  fallbackType = 'file'
}) => {
  const baseName = String(conversationId || fallbackType || 'file').trim() || 'file';
  const fallbackExtension =
    fallbackType === 'image'
      ? 'jpg'
      : fallbackType === 'video'
        ? 'mp4'
        : fallbackType === 'audio'
          ? 'mp3'
          : '';
  const extension =
    getExtensionFromFilename(originalFilename) ||
    getExtensionFromMimeType(mimeType) ||
    fallbackExtension;

  return extension ? `${baseName}.${extension}` : baseName;
};

const triggerBrowserDownload = (url, filename) => {
  const link = document.createElement('a');
  link.href = url;
  if (filename) {
    link.download = filename;
  }
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const saveUrlToComputer = async (sourceUrl, filename) => {
  if (!sourceUrl) return;

  if (sourceUrl.startsWith('blob:') || sourceUrl.startsWith('data:')) {
    triggerBrowserDownload(sourceUrl, filename);
    return;
  }

  try {
    const response = await fetch(sourceUrl, { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    try {
      triggerBrowserDownload(objectUrl, filename);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    triggerBrowserDownload(sourceUrl, filename);
  }
};

const parseBlobJson = async (blob) => {
  if (!(blob instanceof Blob)) return null;

  try {
    return JSON.parse(await blob.text());
  } catch {
    return null;
  }
};

const isRenderableMediaUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  return /^(https?:\/\/|blob:|data:|\/(?!\/))/i.test(url);
};

const isProxyMediaUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  return url.includes('/api/conversations/media/');
};

// Hook to fetch media with proper authentication and Wasabi caching
const useAuthenticatedMedia = (mediaUrl, messageId) => {
  const [blobUrl, setBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [needsDownload, setNeedsDownload] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const downloadMedia = async () => {
    if (!messageId) return;
    
    try {
      setDownloading(true);
      setError(false);

      // Trigger download and cache to Wasabi
      await axiosInstance.post(`/api/conversations/media/${messageId}/download`);

      // Retry fetching the media
      const response = await axiosInstance.get(mediaUrl, {
        responseType: 'blob',
        timeout: 30000
      });

      const objectUrl = URL.createObjectURL(response.data);
      setBlobUrl(objectUrl);
      setNeedsDownload(false);
      setLoading(false);
    } catch (err) {
      console.error('Error downloading media:', err);
      setError(true);
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    // If it's not a proxy URL, use the original URL directly
    if (!isProxyMediaUrl(mediaUrl)) {
      setBlobUrl(mediaUrl);
      setLoading(false);
      return;
    }

    // Fetch media with authentication
    let cancelled = false;
    let objectUrl = null;

    const fetchMedia = async () => {
      try {
        setLoading(true);
        setError(false);

        const response = await axiosInstance.get(mediaUrl, {
          responseType: 'blob',
          timeout: 30000,
          validateStatus: (status) => status === 200 || status === 404
        });

        if (cancelled) return;

        // Check if response is JSON (404 with needsDownload)
        if (response.status === 404) {
          // Parse blob as JSON
          const text = await response.data.text();
          try {
            const jsonData = JSON.parse(text);
            if (jsonData.needsDownload) {
              setNeedsDownload(true);
              setLoading(false);
              return;
            }
          } catch {
            // Not JSON, treat as error
          }
        }

        // Check if it's actually a blob (200 response)
        if (response.status === 200 && response.data instanceof Blob) {
          objectUrl = URL.createObjectURL(response.data);
          setBlobUrl(objectUrl);
          setLoading(false);
          return;
        }

        // Unexpected response
        setError(true);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        
        // Check if it's a 404 with needsDownload flag
        if (err.response?.status === 404) {
          try {
            // Try to parse error response as JSON
            const text = await err.response.data.text();
            const jsonData = JSON.parse(text);
            if (jsonData.needsDownload) {
              setNeedsDownload(true);
              setLoading(false);
              return;
            }
          } catch {
            // Couldn't parse, treat as regular error
          }
        }
        
        console.error('Error fetching authenticated media:', err);
        setError(true);
        setLoading(false);
      }
    };

    fetchMedia();

    // Cleanup
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [mediaUrl]);

  return { blobUrl, loading, error, needsDownload, downloading, downloadMedia };
};

const escapeHtml = (unsafeText = '') =>
  String(unsafeText)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

// Status icon component
const StatusIcon = memo(function StatusIcon({ status }) {
  switch (status) {
    case 'pending':
      return <Clock className="w-3.5 h-3.5 text-white/70" />;
    case 'sent':
      return <Check className="w-3.5 h-3.5 text-white/70" />;
    case 'delivered':
      return <CheckCheck className="w-3.5 h-3.5 text-white/70" />;
    case 'read':
      return <CheckCheck className="w-3.5 h-3.5 text-white" />;
    case 'failed':
      return <AlertCircle className="w-3.5 h-3.5 text-red-300" />;
    default:
      return null;
  }
});

const MediaFallbackCard = memo(function MediaFallbackCard({ title, meta, caption }) {
  return (
    <div className="min-w-[220px] max-w-[300px] p-3 rounded-xl bg-black/5 border border-black/10">
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4" />
        <p className="text-sm font-medium">{title}</p>
      </div>
      {meta && (
        <p className="text-xs opacity-75 mt-1 break-all">
          {meta}
        </p>
      )}
      {caption && (
        <p className="text-sm mt-2 whitespace-pre-wrap break-words">
          {caption}
        </p>
      )}
    </div>
  );
});

const AttachmentPrepareCard = memo(function AttachmentPrepareCard({
  type = 'document',
  title,
  description,
  onPrepare,
  preparing = false
}) {
  const Icon = getAttachmentIconComponent(type);

  return (
    <div className="min-w-[220px] max-w-[300px] rounded-2xl border border-black/10 bg-black/5 p-3">
      <div className="flex items-center gap-3">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-white/80 shadow-sm ring-1 ring-black/5">
          <Icon className="h-6 w-6 text-[#334155]" />
          {onPrepare && (
            <button
              type="button"
              onClick={onPrepare}
              disabled={preparing}
              className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#2A7B6E] text-white shadow-md transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:bg-[#94A3B8]"
              aria-label={`Download ${title || type}`}
            >
              {preparing ? (
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{title || 'Attachment'}</p>
          {description && (
            <p className="mt-0.5 text-xs opacity-75 leading-relaxed">
              {description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

const SaveToComputerButton = memo(function SaveToComputerButton({ onClick, saving = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-black/10 hover:bg-black/15 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {saving ? (
        <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin opacity-70" />
      ) : (
        <Download className="w-3.5 h-3.5" />
      )}
      {saving ? 'Saving...' : 'Save to computer'}
    </button>
  );
});

// Image message component
const ImageMessage = memo(function ImageMessage({
  mediaUrl,
  caption,
  filename,
  mimeType,
  message,
  conversationId
}) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const messageId = message?.id; // Use internal database ID only
  const { blobUrl, loading, error, needsDownload, downloading, downloadMedia } = useAuthenticatedMedia(mediaUrl, messageId);

  if (!isRenderableMediaUrl(mediaUrl)) {
    return <MediaFallbackCard title="Image" meta={mediaUrl} caption={caption} />;
  }

  const saveFilename = buildConversationFilename({
    conversationId,
    originalFilename: filename,
    mimeType,
    fallbackType: 'image'
  });

  const handleSave = async () => {
    if (!blobUrl) return;

    try {
      setSaving(true);
      await saveUrlToComputer(blobUrl, saveFilename);
    } catch (err) {
      console.error('Error saving image:', err);
      alert('Failed to save image');
    } finally {
      setSaving(false);
    }
  };

  if (error && !blobUrl) {
    return <MediaFallbackCard title="Image" meta={mediaUrl} caption={caption} />;
  }

  return (
    <div className="max-w-[280px] space-y-2">
      {needsDownload || downloading ? (
        <AttachmentPrepareCard
          type="image"
          title={filename || 'Image'}
          description={downloading ? 'Preparing this media...' : 'Use the badge to load this media before saving it.'}
          onPrepare={downloadMedia}
          preparing={downloading}
        />
      ) : (
        <div className="relative rounded-xl overflow-hidden bg-black/5 min-h-[120px] shadow-inner">
          {(loading || (!imgLoaded && !error && !needsDownload)) && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#F4F6F8]">
              <div className="w-8 h-8 border-3 border-[#2A7B6E] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {blobUrl ? (
            <img 
              src={blobUrl} 
              alt={caption || 'Image'}
              onLoad={() => setImgLoaded(true)}
              onError={() => setImgLoaded(false)}
              className={`w-full max-h-[300px] object-cover transition-opacity duration-300 ${!imgLoaded ? 'opacity-0' : 'opacity-100'}`}
            />
          ) : null}
        </div>
      )}
      {caption && (
        <p className="mt-2 text-sm whitespace-pre-wrap leading-relaxed">{caption}</p>
      )}
      {blobUrl && (
        <SaveToComputerButton onClick={handleSave} saving={saving} />
      )}
    </div>
  );
});

// Video message component
const VideoMessage = memo(function VideoMessage({
  mediaUrl,
  caption,
  filename,
  mimeType,
  message,
  conversationId
}) {
  const messageId = message?.id; // Use internal database ID only
  const [saving, setSaving] = useState(false);
  const { blobUrl, loading, error, needsDownload, downloading, downloadMedia } = useAuthenticatedMedia(mediaUrl, messageId);

  if (!isRenderableMediaUrl(mediaUrl)) {
    return <MediaFallbackCard title="Video" meta={mediaUrl} caption={caption} />;
  }

  const saveFilename = buildConversationFilename({
    conversationId,
    originalFilename: filename,
    mimeType,
    fallbackType: 'video'
  });

  const handleSave = async () => {
    if (!blobUrl) return;

    try {
      setSaving(true);
      await saveUrlToComputer(blobUrl, saveFilename);
    } catch (err) {
      console.error('Error saving video:', err);
      alert('Failed to save video');
    } finally {
      setSaving(false);
    }
  };

  if (error && !blobUrl) {
    return <MediaFallbackCard title="Video" meta={mediaUrl} caption={caption} />;
  }

  return (
    <div className="max-w-[280px] space-y-2">
      {needsDownload || downloading ? (
        <AttachmentPrepareCard
          type="video"
          title={filename || 'Video'}
          description={downloading ? 'Preparing this video...' : 'Use the badge to load this video before saving it.'}
          onPrepare={downloadMedia}
          preparing={downloading}
        />
      ) : (
        <div className="relative rounded-lg overflow-hidden bg-black min-h-[150px]">
          {loading && !needsDownload && (
            <div className="absolute inset-0 flex items-center justify-center bg-black">
              <div className="w-8 h-8 border-3 border-white border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {blobUrl ? (
            <video 
              src={blobUrl}
              controls
              className="w-full max-h-[300px]"
            />
          ) : null}
        </div>
      )}
      {caption && (
        <p className="mt-1 text-sm whitespace-pre-wrap">{caption}</p>
      )}
      {blobUrl && (
        <SaveToComputerButton onClick={handleSave} saving={saving} />
      )}
    </div>
  );
});

// Audio message component
const AudioMessage = memo(function AudioMessage({
  mediaUrl,
  filename,
  mimeType,
  message,
  conversationId
}) {
  const messageId = message?.id; // Use internal database ID only
  const [saving, setSaving] = useState(false);
  const { blobUrl, loading, error, needsDownload, downloading, downloadMedia } = useAuthenticatedMedia(mediaUrl, messageId);

  if (!isRenderableMediaUrl(mediaUrl)) {
    return <MediaFallbackCard title="Audio" meta={mediaUrl} />;
  }

  const saveFilename = buildConversationFilename({
    conversationId,
    originalFilename: filename,
    mimeType,
    fallbackType: 'audio'
  });

  const handleSave = async () => {
    if (!blobUrl) return;

    try {
      setSaving(true);
      await saveUrlToComputer(blobUrl, saveFilename);
    } catch (err) {
      console.error('Error saving audio:', err);
      alert('Failed to save audio');
    } finally {
      setSaving(false);
    }
  };

  if (error && !blobUrl) {
    return <MediaFallbackCard title="Audio" meta={mediaUrl} />;
  }

  return (
    <div className="min-w-[200px] max-w-[280px] space-y-2">
      {needsDownload || downloading ? (
        <AttachmentPrepareCard
          type="audio"
          title={filename || 'Audio'}
          description={downloading ? 'Preparing this audio...' : 'Use the badge to load this audio before saving it.'}
          onPrepare={downloadMedia}
          preparing={downloading}
        />
      ) : loading ? (
        <div className="flex items-center justify-center h-10 bg-black/5 rounded">
          <div className="w-4 h-4 border-2 border-[#2A7B6E] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : blobUrl ? (
        <audio 
          src={blobUrl} 
          controls 
          className="w-full h-10"
        />
      ) : null}
      {blobUrl && (
        <SaveToComputerButton onClick={handleSave} saving={saving} />
      )}
    </div>
  );
});

// Document message component
const DocumentMessage = memo(function DocumentMessage({
  mediaUrl,
  filename,
  mimeType,
  message,
  conversationId
}) {
  const { icon, color } = getFileIcon(filename, mimeType);
  const messageId = message?.id; // Use internal database ID only
  const [preparing, setPreparing] = useState(false);
  const [needsCache, setNeedsCache] = useState(false);
  const [preparedUrl, setPreparedUrl] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => () => {
    if (preparedUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(preparedUrl);
    }
  }, [preparedUrl]);

  const handlePrepare = async () => {
    if (!isRenderableMediaUrl(mediaUrl)) return;

    if (!isProxyMediaUrl(mediaUrl)) {
      setPreparedUrl(mediaUrl);
      return;
    }

    try {
      setPreparing(true);

      let response = await axiosInstance.get(mediaUrl, {
        responseType: 'blob',
        params: { download: '1' },
        timeout: 30000,
        validateStatus: (status) => status === 200 || status === 404
      });

      if (response.status === 404) {
        const jsonData = await parseBlobJson(response.data);
        if (jsonData?.needsDownload && messageId) {
          setNeedsCache(true);
          await axiosInstance.post(`/api/conversations/media/${messageId}/download`);

          response = await axiosInstance.get(mediaUrl, {
            responseType: 'blob',
            params: { download: '1' },
            timeout: 30000
          });
        } else {
          throw new Error('Document is unavailable');
        }
      }

      const objectUrl = URL.createObjectURL(response.data);
      setPreparedUrl((prev) => {
        if (prev?.startsWith('blob:')) {
          URL.revokeObjectURL(prev);
        }
        return objectUrl;
      });
      setNeedsCache(false);
    } catch (err) {
      console.error('Error downloading document:', err);
      alert('Failed to download document');
    } finally {
      setPreparing(false);
    }
  };

  const handleSave = async () => {
    if (!preparedUrl) return;

    try {
      setSaving(true);
      await saveUrlToComputer(
        preparedUrl,
        buildConversationFilename({
          conversationId,
          originalFilename: filename,
          mimeType,
          fallbackType: 'document'
        })
      );
    } catch (err) {
      console.error('Error saving document:', err);
      alert('Failed to save document');
    } finally {
      setSaving(false);
    }
  };

  const canDownload = isRenderableMediaUrl(mediaUrl);

  return (
    <div className="min-w-[220px] max-w-[300px] space-y-2">
      <div className="flex items-center gap-3 p-3 bg-white/10 backdrop-blur-sm rounded-xl border border-white/20 shadow-sm">
        <div className="relative flex-shrink-0">
          <div 
            className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shadow-md"
            style={{ backgroundColor: `${color}30` }}
          >
            {icon}
          </div>
          {canDownload && !preparedUrl && (
            <button
              type="button"
              onClick={handlePrepare}
              disabled={preparing}
              className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#2A7B6E] text-white shadow-md transition-transform hover:scale-105 disabled:cursor-not-allowed disabled:bg-[#94A3B8]"
              aria-label={`Download ${filename || 'document'}`}
            >
              {preparing ? (
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/70 border-t-transparent animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{filename || 'Document'}</p>
          <p className="text-xs opacity-80 font-medium">
            {preparing
              ? needsCache
                ? 'Fetching from source...'
                : 'Preparing file...'
              : preparedUrl
                ? 'Ready to save'
                : mimeType?.split('/')[1]?.toUpperCase() || 'FILE'}
          </p>
        </div>
        {!canDownload && (
          <p className="text-[10px] opacity-80 flex-shrink-0">ID</p>
        )}
      </div>
      {preparedUrl && (
        <SaveToComputerButton onClick={handleSave} saving={saving} />
      )}
    </div>
  );
});

// Location message component
const LocationMessage = memo(function LocationMessage({ locationData }) {
  const { latitude, longitude, name, address } = locationData || {};
  
  if (!latitude || !longitude) return null;
  
  const mapUrl = `https://maps.google.com/?q=${latitude},${longitude}`;
  
  return (
    <a 
      href={mapUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block max-w-[280px] rounded-lg overflow-hidden"
    >
      <div className="h-32 bg-[#E9EDEF] flex items-center justify-center">
        <MapPin className="w-8 h-8 text-[#00A884]" />
      </div>
      <div className="p-2 bg-black/5">
        {name && <p className="text-sm font-medium truncate">{name}</p>}
        {address && <p className="text-xs text-[#8696A0] truncate">{address}</p>}
      </div>
    </a>
  );
});

// Contact message component
const ContactMessage = memo(function ContactMessage({ contactData }) {
  if (!contactData || !Array.isArray(contactData) || contactData.length === 0) return null;
  
  const contact = contactData[0];
  const { name, phones } = contact || {};
  
  return (
    <div className="min-w-[200px] max-w-[280px] p-3 bg-black/5 rounded-lg">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-full bg-[#00A884] flex items-center justify-center">
          <User className="w-5 h-5 text-white" />
        </div>
        <p className="font-medium">{name?.formatted_name || 'Contact'}</p>
      </div>
      {phones?.length > 0 && (
        <div className="space-y-1">
          {phones.slice(0, 2).map((phone, i) => (
            <p key={i} className="text-sm text-[#00A884] flex items-center gap-1">
              <Phone className="w-3 h-3" />
              {phone.phone}
            </p>
          ))}
        </div>
      )}
    </div>
  );
});

// WhatsApp text formatting
const formatWhatsAppText = (text) => {
  if (!text) return text;
  let safeText = escapeHtml(text);
  
  // Bold: *text*
  safeText = safeText.replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
  // Italic: _text_
  safeText = safeText.replace(/_([^_]+)_/g, '<em>$1</em>');
  // Strikethrough: ~text~
  safeText = safeText.replace(/~([^~]+)~/g, '<del>$1</del>');
  // Monospace: ```text```
  safeText = safeText.replace(/```([^`]+)```/g, '<code class="bg-black/10 px-1 rounded">$1</code>');
  
  return safeText;
};

// Text message component
const TextMessage = memo(function TextMessage({ content }) {
  return (
    <p 
      className="text-[15px] leading-relaxed whitespace-pre-wrap break-words"
      dangerouslySetInnerHTML={{ __html: formatWhatsAppText(content) }}
    />
  );
});

const InteractiveButtons = memo(function InteractiveButtons({ buttons = [] }) {
  if (!Array.isArray(buttons) || buttons.length === 0) return null;

  return (
    <div className="space-y-2">
      {buttons.map((button, index) => {
        const title =
          button?.reply?.title ||
          button?.title ||
          button?.text ||
          button?.payload ||
          `Button ${index + 1}`;

        return (
          <div
            key={`${button?.id || button?.index || title}-${index}`}
            className="px-3 py-2 rounded-lg border border-black/15 bg-black/5 text-sm font-medium"
          >
            <div className="flex items-center gap-2">
              <MousePointerClick className="w-3.5 h-3.5 opacity-70" />
              <span>{title}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
});

const InteractiveList = memo(function InteractiveList({ action }) {
  const sections = Array.isArray(action?.sections) ? action.sections : [];

  return (
    <div className="rounded-xl border border-black/15 bg-black/5 overflow-hidden min-w-[220px] max-w-[320px]">
      <div className="px-3 py-2 border-b border-black/10 flex items-center gap-2">
        <ListChecks className="w-4 h-4 opacity-70" />
        <span className="text-sm font-medium">{action?.button || 'View options'}</span>
      </div>

      <div className="p-2 space-y-2">
        {sections.map((section, sectionIndex) => (
          <div key={`${section?.title || 'section'}-${sectionIndex}`} className="space-y-1">
            {section?.title && (
              <p className="text-xs font-semibold uppercase tracking-wide opacity-70 px-1">
                {section.title}
              </p>
            )}
            {(Array.isArray(section?.rows) ? section.rows : []).map((row, rowIndex) => (
              <div
                key={`${row?.id || row?.title || 'row'}-${rowIndex}`}
                className="px-3 py-2 rounded-lg border border-black/10 bg-white/40"
              >
                <p className="text-sm font-medium">{row?.title || row?.id || `Option ${rowIndex + 1}`}</p>
                {row?.description && (
                  <p className="text-xs opacity-75 mt-0.5">{row.description}</p>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

const ReactionMessage = memo(function ReactionMessage({ reactionData, content }) {
  const emoji = reactionData?.emoji || content || '👍';
  const relatedMessageId = reactionData?.message_id;

  return (
    <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-black/5 border border-black/10">
      <SmilePlus className="w-4 h-4 opacity-75" />
      <span className="text-lg leading-none">{emoji}</span>
      {relatedMessageId && (
        <span className="text-[11px] opacity-70">Reaction</span>
      )}
    </div>
  );
});

const InteractiveMessage = memo(function InteractiveMessage({ content, interactiveData }) {
  if (!interactiveData) {
    return <TextMessage content={content} />;
  }

  const interactiveType = String(interactiveData.type || '').toLowerCase();
  const actionButtons = Array.isArray(interactiveData?.action?.buttons)
    ? interactiveData.action.buttons
    : [];
  const templateButtons = Array.isArray(interactiveData?.buttons)
    ? interactiveData.buttons
    : [];

  if (interactiveType === 'button_reply' || (interactiveType === 'button' && actionButtons.length === 0)) {
    const selectedTitle =
      interactiveData?.title ||
      interactiveData?.text ||
      interactiveData?.payload ||
      content ||
      '[Button Reply]';
    return (
      <div className="space-y-2">
        {content && content !== selectedTitle && <TextMessage content={content} />}
        <div className="px-3 py-2 rounded-lg border border-black/15 bg-black/5 text-sm font-medium inline-flex items-center gap-2">
          <MousePointerClick className="w-3.5 h-3.5 opacity-70" />
          <span>{selectedTitle}</span>
        </div>
      </div>
    );
  }

  if (interactiveType === 'list_reply') {
    const selectedTitle =
      interactiveData?.title ||
      interactiveData?.id ||
      content ||
      '[List Reply]';
    return (
      <div className="space-y-2">
        {content && content !== selectedTitle && <TextMessage content={content} />}
        <div className="px-3 py-2 rounded-lg border border-black/15 bg-black/5">
          <p className="text-sm font-medium">{selectedTitle}</p>
          {interactiveData?.description && (
            <p className="text-xs opacity-75 mt-0.5">{interactiveData.description}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {content && <TextMessage content={content} />}

      {interactiveType === 'list' && <InteractiveList action={interactiveData.action} />}

      {(interactiveType === 'button' || interactiveType === 'template') && (
        <InteractiveButtons buttons={actionButtons.length > 0 ? actionButtons : templateButtons} />
      )}
    </div>
  );
});

// Main MessageBubble component
const MessageBubble = memo(function MessageBubble({ 
  message, 
  isOwn,
  showTail = true,
  conversationId
}) {
  const resolvedMessage = resolveMessageForRendering(message);

  const {
    message_content: content,
    message_type: type,
    media_url: mediaUrl,
    media_filename: filename,
    media_caption: caption,
    media_mime_type: mimeType,
    location_data: locationData,
    contact_data: contactData,
    interactive_data: interactiveData,
    reaction_data: reactionData,
    timestamp,
    status,
    direction
  } = resolvedMessage;
  
  const isOutbound = direction === 'outbound' || isOwn;
  const time = formatTime(timestamp);
  
  // Render message content based on type
  const renderContent = () => {
    switch (type) {
      case 'image':
        return (
          <ImageMessage
            mediaUrl={mediaUrl}
            caption={caption}
            filename={filename}
            mimeType={mimeType}
            message={message}
            conversationId={conversationId}
          />
        );
      case 'video':
        return (
          <VideoMessage
            mediaUrl={mediaUrl}
            caption={caption}
            filename={filename}
            mimeType={mimeType}
            message={message}
            conversationId={conversationId}
          />
        );
      case 'audio':
        return (
          <AudioMessage
            mediaUrl={mediaUrl}
            filename={filename}
            mimeType={mimeType}
            message={message}
            conversationId={conversationId}
          />
        );
      case 'document':
        return (
          <DocumentMessage
            mediaUrl={mediaUrl}
            filename={filename}
            mimeType={mimeType}
            message={message}
            conversationId={conversationId}
          />
        );
      case 'sticker':
        return (
          <ImageMessage
            mediaUrl={mediaUrl}
            caption={caption || '[Sticker]'}
            filename={filename}
            mimeType={mimeType}
            message={message}
            conversationId={conversationId}
          />
        );
      case 'location':
        return <LocationMessage locationData={locationData} />;
      case 'contacts':
      case 'contact':
        return <ContactMessage contactData={contactData} />;
      case 'interactive':
      case 'template':
      case 'button':
      case 'button_reply':
      case 'list_reply':
        return <InteractiveMessage content={content} interactiveData={interactiveData} />;
      case 'reaction':
        return <ReactionMessage reactionData={reactionData} content={content} />;
      default:
        return <TextMessage content={content} />;
    }
  };
  
  return (
    <div 
      className={`flex flex-col max-w-[75%] sm:max-w-[65%] ${
        isOutbound ? 'items-end' : 'items-start'
      }`}
    >
      <div 
        className={`relative px-4 py-2.5 rounded-2xl shadow-md transition-all hover:shadow-lg ${
          isOutbound 
            ? 'bg-gradient-to-br from-[#2A7B6E] to-[#3A8B7E] text-white' 
            : 'bg-white text-[#334155] border border-[#E2E8F0]'
        }`}
        style={{
          // Message tail effect using pseudo-element style
          ...(showTail && isOutbound && {
            borderBottomRightRadius: '4px',
          }),
          ...(showTail && !isOutbound && {
            borderBottomLeftRadius: '4px',
          })
        }}
      >
        {renderContent()}
        
        {/* Time and Status */}
        <div className={`flex items-center justify-end gap-1.5 mt-1 ${type !== 'text' && !content ? '-mt-1' : ''}`}>
          <span className={`text-[11px] font-medium ${
            isOutbound ? 'text-white/80' : 'text-[#64748B]'
          }`}>
            {time}
          </span>
          {isOutbound && <StatusIcon status={status} />}
        </div>
      </div>
    </div>
  );
});

export default MessageBubble;

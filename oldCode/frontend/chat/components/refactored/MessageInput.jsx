'use client';

import { useState, useRef, useCallback, memo } from 'react';
import { 
  Send, Paperclip, Smile, Image as ImageIcon, FileText, Mic, X
} from 'lucide-react';

// Emoji picker data (common emojis)
const EMOJI_CATEGORIES = {
  'Smileys': ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙', '🥲', '😋'],
  'Gestures': ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👋', '🖐️', '✋', '👏', '🙌', '👐', '🤲', '🙏', '✍️', '💪', '🦾'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝'],
  'Objects': ['📱', '💻', '⌨️', '🖥️', '🖨️', '📞', '📠', '📺', '📻', '📷', '📹', '🎥', '📽️', '🎬', '📧', '📨', '📩', '💬']
};

// File type detection
const getFileType = (file) => {
  const type = file.type;
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf') return 'pdf';
  return 'document';
};

// Attachment preview component
const AttachmentPreview = memo(function AttachmentPreview({ attachment, onRemove }) {
  const { file, type, preview } = attachment;
  
  if (type === 'image' && preview) {
    return (
      <div className="relative group">
        <img 
          src={preview} 
          alt="Preview"
          className="w-20 h-20 object-cover rounded-xl border-2 border-[#E2E8F0] shadow-md"
        />
        <button
          onClick={() => onRemove()}
          className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-lg hover:scale-110"
          aria-label="Remove attachment"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }
  
  return (
    <div className="relative group flex items-center gap-2 px-3 py-2 bg-[#F4F6F8] border border-[#E2E8F0] rounded-xl shadow-sm">
      <FileText className="w-4 h-4 text-[#64748B]" />
      <span className="text-xs font-medium text-[#334155] max-w-[100px] truncate">
        {file.name}
      </span>
      <button
        onClick={() => onRemove()}
        className="w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all ml-1 hover:scale-110"
        aria-label="Remove attachment"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
});

// Emoji picker component
const EmojiPicker = memo(function EmojiPicker({ onSelect, onClose }) {
  const [activeCategory, setActiveCategory] = useState('Smileys');
  
  return (
    <div className="absolute bottom-full left-0 mb-2 w-72 bg-white rounded-xl shadow-2xl border border-[#E2E8F0] overflow-hidden z-50">
      {/* Category tabs */}
      <div className="flex border-b border-[#E2E8F0] bg-[#FAFBFC]">
        {Object.keys(EMOJI_CATEGORIES).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`flex-1 py-2.5 text-xs font-semibold transition-all ${
              activeCategory === cat 
                ? 'text-[#2A7B6E] bg-white border-b-2 border-[#2A7B6E]' 
                : 'text-[#64748B] hover:bg-white hover:text-[#334155]'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>
      
      {/* Emoji grid */}
      <div className="grid grid-cols-8 gap-1 p-3 max-h-52 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#2A7B6E #F4F6F8' }}>
        {EMOJI_CATEGORIES[activeCategory].map((emoji, i) => (
          <button
            key={i}
            onClick={() => {
              onSelect(emoji);
              onClose();
            }}
            className="w-8 h-8 flex items-center justify-center hover:bg-[#E8F5F3] rounded-lg text-xl transition-all hover:scale-125"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
});

// Main MessageInput component
export default function MessageInput({
  onSendMessage,
  onAttachMedia,
  disabled = false,
  placeholder = "Type a message..."
}) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  
  // Handle send message
  const handleSend = useCallback(() => {
    if (disabled) return;
    if (!message.trim() && attachments.length === 0) return;
    
    onSendMessage?.({
      text: message.trim(),
      attachments: attachments.map(a => ({
        file: a.file,
        type: a.type
      }))
    });
    
    setMessage('');
    setAttachments([]);
    
    // Reset textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [message, attachments, disabled, onSendMessage]);
  
  // Handle key press
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);
  
  // Handle text change
  const handleTextChange = useCallback((e) => {
    setMessage(e.target.value);
    
    // Auto-resize
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 88) + 'px';
    }
  }, []);
  
  // Handle file select
  const handleFileSelect = useCallback((e) => {
    const files = Array.from(e.target.files || []);
    const newAttachments = files.map(file => ({
      file,
      type: getFileType(file),
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    }));
    
    setAttachments(prev => [...prev, ...newAttachments]);
    onAttachMedia?.(newAttachments);
    setShowAttachMenu(false);
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onAttachMedia]);
  
  // Remove attachment
  const removeAttachment = useCallback((index) => {
    setAttachments(prev => {
      const attachment = prev[index];
      if (attachment?.preview) {
        URL.revokeObjectURL(attachment.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);
  
  // Insert emoji
  const insertEmoji = useCallback((emoji) => {
    setMessage(prev => prev + emoji);
    textareaRef.current?.focus();
  }, []);
  
  return (
    <div className="shrink-0 bg-white px-3 py-2 border-t border-[#E2E8F0] shadow-lg">
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 pb-2 border-b border-[#E2E8F0]">
          {attachments.map((attachment, index) => (
            <AttachmentPreview
              key={index}
              attachment={attachment}
              onRemove={() => removeAttachment(index)}
            />
          ))}
        </div>
      )}
      
      {/* Input row */}
      <div className="flex items-end gap-1.5 min-h-[32px]">
        {/* Emoji button */}
        <div className="relative">
          <button
            onClick={() => setShowEmoji(!showEmoji)}
            disabled={disabled}
            className="w-8 h-8 flex items-center justify-center text-[#64748B] hover:text-[#2A7B6E] hover:bg-[#E8F5F3] rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Add emoji"
          >
            <Smile className="w-4 h-4" />
          </button>
          
          {showEmoji && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setShowEmoji(false)} 
              />
              <EmojiPicker 
                onSelect={insertEmoji}
                onClose={() => setShowEmoji(false)}
              />
            </>
          )}
        </div>
        
        {/* Attachment button */}
        <div className="relative">
          <button
            onClick={() => setShowAttachMenu(!showAttachMenu)}
            disabled={disabled}
            className="w-8 h-8 flex items-center justify-center text-[#64748B] hover:text-[#2A7B6E] hover:bg-[#E8F5F3] rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Attach file"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          
          {showAttachMenu && (
            <>
              <div 
                className="fixed inset-0 z-40" 
                onClick={() => setShowAttachMenu(false)} 
              />
              <div className="absolute bottom-full left-0 mb-2 w-56 bg-white rounded-xl shadow-2xl border border-[#E2E8F0] overflow-hidden z-50">
                <button
                  onClick={() => {
                    fileInputRef.current?.click();
                    setShowAttachMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F4F6F8] transition-colors text-left"
                >
                  <div className="w-10 h-10 bg-gradient-to-br from-[#2A7B6E] to-[#3A8B7E] rounded-xl flex items-center justify-center">
                    <ImageIcon className="w-5 h-5 text-white" />
                  </div>
                  <span className="text-sm font-medium text-[#334155]">Photo & Video</span>
                </button>
                <button
                  onClick={() => {
                    fileInputRef.current?.click();
                    setShowAttachMenu(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F4F6F8] transition-colors text-left"
                >
                  <div className="w-10 h-10 bg-[#F4F6F8] rounded-xl flex items-center justify-center">
                    <FileText className="w-5 h-5 text-[#64748B]" />
                  </div>
                  <span className="text-sm font-medium text-[#334155]">Document</span>
                </button>
              </div>
            </>
          )}
          
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt,.xls,.xlsx"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
        
        {/* Text input */}
        <div className="flex-1 min-w-0 relative flex">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="flex-1 w-full px-3 py-2 bg-[#F4F6F8] border-2 border-transparent rounded-lg resize-none focus:outline-none focus:border-[#2A7B6E] focus:bg-white focus:ring-2 focus:ring-[#2A7B6E]/10 text-[#334155] placeholder-[#64748B] text-sm leading-5 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            style={{ minHeight: '32px', maxHeight: '88px' }}
          />
        </div>
        
        {/* Send / Mic button */}
        <button
          onClick={handleSend}
          disabled={disabled || (!message.trim() && attachments.length === 0)}
          className="w-9 h-9 flex items-center justify-center bg-gradient-to-br from-[#2A7B6E] to-[#3A8B7E] text-white rounded-lg hover:shadow-lg hover:scale-105 transition-all disabled:bg-[#E2E8F0] disabled:text-[#8696A0] disabled:cursor-not-allowed disabled:scale-100 shadow-md"
          aria-label={message.trim() || attachments.length > 0 ? 'Send message' : 'Record voice message'}
        >
          {message.trim() || attachments.length > 0 ? (
            <Send className="w-4 h-4" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
}

'use client';

import { useState, useRef } from 'react';
import { Send, Paperclip, Smile, Image, FileText, Mic, X } from 'lucide-react';

export default function MessageComposer({ 
  onSendMessage, 
  onAttachMedia, 
  disabled = false,
  placeholder = "Type a message...",
  showAttachments = true,
  showEmoji = true 
}) {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const handleSendMessage = (e) => {
    // Prevent any default form submission behavior
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    if (!message.trim() && attachments.length === 0) return;

    const messageData = {
      text: message.trim(),
      attachments: attachments
    };

    onSendMessage(messageData);
    setMessage('');
    setAttachments([]);
    
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      handleSendMessage();
    }
  };

  const handleTextChange = (e) => {
    setMessage(e.target.value);
    
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }

    // Handle typing indicator
    if (!isTyping && e.target.value.trim()) {
      setIsTyping(true);
      // You could emit typing status here
    } else if (isTyping && !e.target.value.trim()) {
      setIsTyping(false);
      // You could stop typing status here
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    const newAttachments = files.map(file => ({
      file,
      type: getFileType(file),
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    }));
    
    setAttachments(prev => [...prev, ...newAttachments]);
    
    if (onAttachMedia) {
      onAttachMedia(newAttachments);
    }
  };

  const removeAttachment = (index) => {
    setAttachments(prev => {
      const attachment = prev[index];
      if (attachment.preview) {
        URL.revokeObjectURL(attachment.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const getFileType = (file) => {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    if (file.type === 'application/pdf') return 'pdf';
    return 'document';
  };

  const getFileIcon = (type) => {
    switch (type) {
      case 'image':
        return <Image className="w-4 h-4" />;
      case 'video':
        return <FileText className="w-4 h-4" />;
      case 'audio':
        return <Mic className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  return (
    <div className="bg-white border-t border-gray-200">
      {/* Attachment Previews */}
      {attachments.length > 0 && (
        <div className="p-3 border-b border-gray-200">
          <div className="flex flex-wrap gap-2">
            {attachments.map((attachment, index) => (
              <div key={index} className="relative group">
                {attachment.preview ? (
                  /* Image Preview */
                  <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-300">
                    <img 
                      src={attachment.preview} 
                      alt="Preview" 
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() => removeAttachment(index)}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  /* File Preview */
                  <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 py-2 pr-8 relative group">
                    {getFileIcon(attachment.type)}
                    <span className="text-sm text-gray-700 truncate max-w-[100px]">
                      {attachment.file.name}
                    </span>
                    <button
                      onClick={() => removeAttachment(index)}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-4">
        <div className="flex items-end space-x-2">
          {/* Attachment Button */}
          {showAttachments && (
            <div className="flex-shrink-0">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Attach file"
              >
                <Paperclip className="w-5 h-5" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          )}

          {/* Text Input */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={message}
              onChange={handleTextChange}
              onKeyPress={handleKeyPress}
              placeholder={placeholder}
              disabled={disabled}
              rows={1}
              className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-full resize-none focus:outline-none focus:ring-2 focus:ring-[#2A7B6E] focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
              style={{ minHeight: '40px', maxHeight: '120px' }}
            />
            
            {/* Emoji Button */}
            {showEmoji && (
              <button
                disabled={disabled}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                title="Insert emoji"
              >
                <Smile className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Send Button */}
          <div className="flex-shrink-0">
            <button
              onClick={(e) => handleSendMessage(e)}
              disabled={disabled || (!message.trim() && attachments.length === 0)}
              className="p-2 bg-[#2A7B6E] text-white rounded-full hover:bg-[#24695F] transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
              title="Send message"
              type="button"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Character Count (optional) */}
        {message.length > 100 && (
          <div className="text-xs text-gray-500 text-right mt-1">
            {message.length}/1000
          </div>
        )}
      </div>
    </div>
  );
}

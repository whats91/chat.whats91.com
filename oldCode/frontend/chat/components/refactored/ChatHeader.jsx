'use client';

import { memo, useState, useRef, useEffect } from 'react';
import { 
  ArrowLeft, MoreVertical, Search, 
  User, Star, Ban, Trash2, VolumeX, Image as ImageIcon,
  Flag, X
} from 'lucide-react';

// Contact info panel
const ContactInfoPanel = memo(function ContactInfoPanel({ 
  conversation, 
  onClose 
}) {
  const displayName = conversation?.display_name || conversation?.contact_phone || 'Unknown';
  
  return (
    <div className="absolute inset-0 bg-white z-30 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-4 bg-gradient-to-r from-[#2A7B6E] to-[#3A8B7E] text-white shadow-lg">
        <button 
          onClick={onClose} 
          className="p-2 hover:bg-white/10 rounded-xl transition-colors"
          aria-label="Close contact info"
        >
          <X className="w-5 h-5" />
        </button>
        <span className="font-semibold text-lg">Contact Info</span>
      </div>
      
      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-gradient-to-br from-[#FAFBFC] to-white">
        {/* Avatar and name */}
        <div className="flex flex-col items-center py-8 bg-white border-b border-[#E2E8F0]">
          <div className="w-32 h-32 rounded-full bg-gradient-to-br from-[#2A7B6E] to-[#3A8B7E] flex items-center justify-center mb-4 shadow-xl">
            {conversation?.profile_picture ? (
              <img 
                src={conversation.profile_picture}
                alt={displayName}
                className="w-full h-full rounded-full object-cover"
              />
            ) : (
              <span className="text-5xl font-bold text-white">
                {displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <h2 className="text-xl font-bold text-[#334155] mb-1">{displayName}</h2>
          <p className="text-sm text-[#64748B] font-medium">{conversation?.contact_phone}</p>
        </div>
        
        {/* Actions */}
        <div className="bg-white mt-4 mx-4 rounded-xl border border-[#E2E8F0] overflow-hidden shadow-sm">
          <button className="w-full flex items-center gap-4 px-6 py-4 hover:bg-[#F4F6F8] transition-colors border-b border-[#E2E8F0]">
            <Star className="w-5 h-5 text-[#64748B]" />
            <span className="text-sm font-medium text-[#334155]">Starred Messages</span>
          </button>
          <button className="w-full flex items-center gap-4 px-6 py-4 hover:bg-[#F4F6F8] transition-colors border-b border-[#E2E8F0]">
            <VolumeX className="w-5 h-5 text-[#64748B]" />
            <span className="text-sm font-medium text-[#334155]">Mute Notifications</span>
          </button>
          <button className="w-full flex items-center gap-4 px-6 py-4 hover:bg-red-50 transition-colors border-b border-[#E2E8F0] text-red-600">
            <Ban className="w-5 h-5" />
            <span className="text-sm font-medium">Block Contact</span>
          </button>
          <button className="w-full flex items-center gap-4 px-6 py-4 hover:bg-red-50 transition-colors border-b border-[#E2E8F0] text-red-600">
            <Flag className="w-5 h-5" />
            <span className="text-sm font-medium">Report Contact</span>
          </button>
          <button className="w-full flex items-center gap-4 px-6 py-4 hover:bg-red-50 transition-colors text-red-600">
            <Trash2 className="w-5 h-5" />
            <span className="text-sm font-medium">Delete Chat</span>
          </button>
        </div>
      </div>
    </div>
  );
});

// Main ChatHeader component
export default function ChatHeader({
  conversation,
  onBack,
  showBackButton = false,
  messageSearchTerm = '',
  onMessageSearchChange,
  statusPlaceholder = 'Status unavailable'
}) {
  const [showInfo, setShowInfo] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const menuRef = useRef(null);
  const searchInputRef = useRef(null);
  
  // Close menu on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
      }
    };
    
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    if (!showSearch) {
      return;
    }

    const focusInput = () => searchInputRef.current?.focus();
    const frameId = requestAnimationFrame(focusInput);

    return () => cancelAnimationFrame(frameId);
  }, [showSearch]);

  useEffect(() => {
    setShowSearch(false);
    onMessageSearchChange?.('');
  }, [conversation?.id, onMessageSearchChange]);

  const handleOpenSearch = () => {
    setShowSearch(true);
    setShowMenu(false);
  };

  const handleCloseSearch = () => {
    setShowSearch(false);
    onMessageSearchChange?.('');
  };
  
  if (!conversation) {
    return (
      <div className="flex h-[46px] items-center justify-between px-3 bg-[#F0F2F5] border-b border-[#E9EDEF]">
        <p className="text-[#8696A0] text-sm">Select a conversation</p>
      </div>
    );
  }
  
  const displayName = conversation.display_name || conversation.contact_phone || 'Unknown';
  
  return (
    <>
      <div className="flex h-[46px] items-center justify-between px-3 bg-white border-b border-[#E2E8F0] shadow-sm">
        {/* Left section */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Back button (mobile) */}
          {showBackButton && (
            <button 
              onClick={onBack}
              className="flex h-8 w-8 items-center justify-center -ml-1 text-[#64748B] hover:text-[#334155] hover:bg-[#F4F6F8] rounded-lg transition-all lg:hidden"
              aria-label="Back to conversations"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          
          {/* Avatar and info - clickable */}
          <button 
            onClick={() => setShowInfo(true)}
            className="flex items-center gap-2 hover:bg-[#F4F6F8] rounded-lg px-1.5 py-1 -ml-1 transition-all min-w-0"
          >
            <div className="w-[34px] h-[34px] rounded-full bg-gradient-to-br from-[#2A7B6E] to-[#3A8B7E] flex items-center justify-center overflow-hidden shadow-md flex-shrink-0">
              {conversation.profile_picture ? (
                <img 
                  src={conversation.profile_picture}
                  alt={displayName}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="text-sm font-semibold text-white">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            
            <div className="text-left min-w-0">
              <h2 className="font-semibold text-[#334155] text-sm leading-4 truncate">
                {displayName}
              </h2>
              <p className="text-[10px] leading-3 text-[#64748B] truncate">
                {statusPlaceholder}
              </p>
            </div>
          </button>
        </div>
        
        {/* Right section - actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {showSearch ? (
            <>
              <div className="relative w-40 sm:w-56">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#64748B]" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={messageSearchTerm}
                  onChange={(e) => onMessageSearchChange?.(e.target.value)}
                  placeholder="Search messages"
                  className="h-8 w-full rounded-lg border border-[#D7E0E7] bg-[#F8FAFC] pl-8 pr-8 text-sm text-[#334155] placeholder-[#64748B] focus:outline-none focus:border-[#2A7B6E] focus:ring-2 focus:ring-[#2A7B6E]/10"
                />
                {messageSearchTerm ? (
                  <button
                    type="button"
                    onClick={() => onMessageSearchChange?.('')}
                    className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-[#64748B] hover:bg-[#E2E8F0]"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>

              <button
                type="button"
                onClick={handleCloseSearch}
                className="w-8 h-8 flex items-center justify-center text-[#64748B] hover:text-[#2A7B6E] hover:bg-[#E8F5F3] rounded-lg transition-all"
                aria-label="Close search"
                title="Close search"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button 
              type="button"
              onClick={handleOpenSearch}
              className="w-8 h-8 flex items-center justify-center text-[#64748B] hover:text-[#2A7B6E] hover:bg-[#E8F5F3] rounded-lg transition-all"
              aria-label="Search messages"
              title="Search messages"
            >
              <Search className="w-4 h-4" />
            </button>
          )}
          
          <div className="relative" ref={menuRef}>
            <button 
              onClick={() => setShowMenu(!showMenu)}
              className="w-8 h-8 flex items-center justify-center text-[#64748B] hover:text-[#2A7B6E] hover:bg-[#E8F5F3] rounded-lg transition-all"
              title="Menu"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
            
            {showMenu && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-2xl border border-[#E2E8F0] overflow-hidden z-50">
                <button 
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F4F6F8] transition-colors text-left"
                  onClick={() => {
                    setShowInfo(true);
                    setShowMenu(false);
                  }}
                >
                  <User className="w-5 h-5 text-[#64748B]" />
                  <span className="text-sm font-medium text-[#334155]">Contact Info</span>
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F4F6F8] transition-colors text-left">
                  <Star className="w-5 h-5 text-[#64748B]" />
                  <span className="text-sm font-medium text-[#334155]">Starred Messages</span>
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F4F6F8] transition-colors text-left">
                  <VolumeX className="w-5 h-5 text-[#64748B]" />
                  <span className="text-sm font-medium text-[#334155]">Mute Notifications</span>
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#F4F6F8] transition-colors text-left">
                  <ImageIcon className="w-5 h-5 text-[#64748B]" />
                  <span className="text-sm font-medium text-[#334155]">Wallpaper</span>
                </button>
                <div className="border-t border-[#E2E8F0] my-1" />
                <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-50 transition-colors text-left text-red-600">
                  <Ban className="w-5 h-5" />
                  <span className="text-sm font-medium">Block {displayName}</span>
                </button>
                <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-50 transition-colors text-left text-red-600">
                  <Flag className="w-5 h-5" />
                  <span className="text-sm font-medium">Report {displayName}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Contact info panel */}
      {showInfo && (
        <ContactInfoPanel 
          conversation={conversation}
          onClose={() => setShowInfo(false)}
        />
      )}
    </>
  );
}

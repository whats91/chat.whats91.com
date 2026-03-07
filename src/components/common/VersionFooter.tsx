'use client';

import { useEffect, useState } from 'react';

interface VersionInfo {
  version: string;
  git: {
    commit: string;
    branch: string;
  };
  timestamp: string;
  environment: string;
}

export function VersionFooter() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/version')
      .then(res => res.json())
      .then(data => {
        setVersionInfo(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  if (loading || !versionInfo) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 pointer-events-none z-50">
      <div className="flex justify-end p-2">
        <div className="text-[9px] text-muted-foreground/30 font-mono bg-background/50 backdrop-blur-sm px-2 py-0.5 rounded pointer-events-auto">
          v{versionInfo.version}
          {versionInfo.git.commit !== 'unknown' && (
            <span className="ml-1">({versionInfo.git.commit})</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default VersionFooter;

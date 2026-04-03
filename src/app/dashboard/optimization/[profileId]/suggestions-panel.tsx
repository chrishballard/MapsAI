'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';

// --- Interfaces ---

interface SavedDescription {
  id: string;
  content: string;
  isApproved: boolean;
  isPushed: boolean;
  pushedAt: string | null;
}

interface ServiceItem {
  id?: string;
  serviceName: string;
  description: string;
  isStructured: boolean;
  isApproved: boolean;
  isPushed: boolean;
  pushedAt: string | null;
}

interface SuggestionsPanelProps {
  profileId: string;
}

export function SuggestionsPanel({ profileId }: SuggestionsPanelProps) {
  const [loading, setLoading] = useState(true);
  const [savedDescription, setSavedDescription] = useState<SavedDescription | null>(null);
  const [savedServices, setSavedServices] = useState<ServiceItem[]>([]);
  const [ignoredDescIds, setIgnoredDescIds] = useState<Set<string>>(new Set());
  const [ignoredServiceIds, setIgnoredServiceIds] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState(false);
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [bulkIgnoreOpen, setBulkIgnoreOpen] = useState(false);

  // Fetch data on mount
  useEffect(() => {
    async function fetchData() {
      try {
        const [descRes, svcRes] = await Promise.all([
          fetch(`/api/reoptimize/description?profileId=${profileId}`),
          fetch(`/api/reoptimize/services?profileId=${profileId}`),
        ]);

        if (descRes.ok) {
          const descData = await descRes.json();
          setSavedDescription(descData.savedDescription ?? null);
        }

        if (svcRes.ok) {
          const svcData = await svcRes.json();
          setSavedServices(svcData.savedServices ?? []);
        }
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [profileId]);

  // Pending detection
  const hasPendingDescription =
    savedDescription !== null &&
    !savedDescription.isApproved &&
    !savedDescription.isPushed &&
    !ignoredDescIds.has(savedDescription.id);

  const pendingServices = savedServices.filter(
    (svc) =>
      !svc.isApproved &&
      !svc.isPushed &&
      !ignoredServiceIds.has(svc.id ?? svc.serviceName)
  );

  const pendingCount = (hasPendingDescription ? 1 : 0) + pendingServices.length;

  // --- Handlers ---

  async function handleApproveDescription() {
    if (!savedDescription) return;
    setPushing(true);
    try {
      const res = await fetch('/api/reoptimize/description/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId, content: savedDescription.content }),
      });
      if (res.ok) {
        setSavedDescription((prev) =>
          prev ? { ...prev, isApproved: true, isPushed: true } : prev
        );
      }
    } finally {
      setPushing(false);
    }
  }

  function handleIgnoreDescription() {
    if (!savedDescription) return;
    setIgnoredDescIds((prev) => new Set([...prev, savedDescription.id]));
  }

  async function handleApproveService(svc: ServiceItem) {
    // Mark service approved locally
    setSavedServices((prev) =>
      prev.map((s) =>
        (s.id ?? s.serviceName) === (svc.id ?? svc.serviceName)
          ? { ...s, isApproved: true }
          : s
      )
    );
    // Push all approved services
    setPushing(true);
    try {
      await fetch('/api/reoptimize/services/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      });
      setSavedServices((prev) =>
        prev.map((s) =>
          (s.id ?? s.serviceName) === (svc.id ?? svc.serviceName)
            ? { ...s, isApproved: true, isPushed: true }
            : s
        )
      );
    } finally {
      setPushing(false);
    }
  }

  function handleIgnoreService(svc: ServiceItem) {
    setIgnoredServiceIds((prev) => new Set([...prev, svc.id ?? svc.serviceName]));
  }

  async function handleBulkApprove() {
    setPushing(true);
    try {
      const promises: Promise<unknown>[] = [];

      if (hasPendingDescription && savedDescription) {
        promises.push(
          fetch('/api/reoptimize/description/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId, content: savedDescription.content }),
          }).then(() => {
            setSavedDescription((prev) =>
              prev ? { ...prev, isApproved: true, isPushed: true } : prev
            );
          })
        );
      }

      if (pendingServices.length > 0) {
        // Mark all pending services as approved locally first
        setSavedServices((prev) =>
          prev.map((s) =>
            !s.isApproved && !s.isPushed && !ignoredServiceIds.has(s.id ?? s.serviceName)
              ? { ...s, isApproved: true }
              : s
          )
        );
        promises.push(
          fetch('/api/reoptimize/services/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId }),
          }).then(() => {
            setSavedServices((prev) =>
              prev.map((s) =>
                s.isApproved && !s.isPushed ? { ...s, isPushed: true } : s
              )
            );
          })
        );
      }

      await Promise.all(promises);
    } finally {
      setPushing(false);
      setBulkApproveOpen(false);
    }
  }

  function handleBulkIgnore() {
    if (savedDescription && hasPendingDescription) {
      setIgnoredDescIds((prev) => new Set([...prev, savedDescription.id]));
    }
    pendingServices.forEach((svc) => {
      setIgnoredServiceIds((prev) => new Set([...prev, svc.id ?? svc.serviceName]));
    });
    setBulkIgnoreOpen(false);
  }

  // --- Render ---

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-zinc-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Loading suggestions...</span>
      </div>
    );
  }

  if (pendingCount === 0) {
    return (
      <Card className="border-emerald-200 bg-emerald-50">
        <CardContent className="flex items-center gap-3 p-4">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          <p className="text-emerald-700 font-medium">All suggestions have been reviewed!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Bulk actions toolbar */}
      <div className="flex items-center justify-between py-3">
        <p className="text-sm text-zinc-500">
          {pendingCount} pending suggestion{pendingCount !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setBulkIgnoreOpen(true)}>
            Ignore All
          </Button>
          <Button size="sm" onClick={() => setBulkApproveOpen(true)}>
            Approve All
          </Button>
        </div>
      </div>

      {/* Description suggestion card */}
      {hasPendingDescription && savedDescription && (
        <Card>
          <CardHeader>
            <CardTitle>Description Suggestion</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-600 whitespace-pre-wrap">{savedDescription.content}</p>
          </CardContent>
          <CardFooter className="gap-2">
            <Button
              size="sm"
              onClick={handleApproveDescription}
              disabled={pushing}
            >
              {pushing && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Approve &amp; Push
            </Button>
            <Button variant="outline" size="sm" onClick={handleIgnoreDescription}>
              Ignore
            </Button>
          </CardFooter>
        </Card>
      )}

      {/* Service suggestion cards */}
      {pendingServices.map((svc) => (
        <Card key={svc.id ?? svc.serviceName}>
          <CardHeader>
            <CardTitle>{svc.serviceName}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-zinc-600 whitespace-pre-wrap">{svc.description}</p>
          </CardContent>
          <CardFooter className="gap-2">
            <Button
              size="sm"
              onClick={() => handleApproveService(svc)}
              disabled={pushing}
            >
              {pushing && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
              Approve &amp; Push
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleIgnoreService(svc)}>
              Ignore
            </Button>
          </CardFooter>
        </Card>
      ))}

      {/* Bulk Approve Dialog */}
      <Dialog open={bulkApproveOpen} onOpenChange={setBulkApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve all pending suggestions?</DialogTitle>
            <DialogDescription>
              This will approve and push {pendingCount} pending item{pendingCount !== 1 ? 's' : ''} to Google Business Profile.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button onClick={handleBulkApprove} disabled={pushing}>
              {pushing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Approve All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Ignore Dialog */}
      <Dialog open={bulkIgnoreOpen} onOpenChange={setBulkIgnoreOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ignore all pending suggestions?</DialogTitle>
            <DialogDescription>
              This will dismiss {pendingCount} pending suggestion{pendingCount !== 1 ? 's' : ''}. No changes will be pushed to Google Business Profile.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline">Cancel</Button>} />
            <Button variant="outline" onClick={handleBulkIgnore}>
              Ignore All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

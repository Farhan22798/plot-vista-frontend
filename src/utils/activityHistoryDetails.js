/**
 * Rich activity copy from ActivityLog prevData/newData (already stored in DB).
 */

import { formatDateTime, nameOnly } from './formatting';
import { formatRemarkLogForExport, getRemarkEntries } from './remarkLog';
import { labelForCustomerCategory, normalizeCustomerCategory } from './customerCategory';

function safeList(x) {
  return Array.isArray(x) ? x : [];
}

function idSet(list) {
  return new Set(safeList(list).map((w) => String(w._id)));
}

export function removedWaitersFromSnapshots(prevData, newData) {
  const prev = safeList(prevData?.waitingList);
  const next = safeList(newData?.waitingList);
  const keep = idSet(next);
  return prev.filter((w) => w._id != null && !keep.has(String(w._id)));
}

export function addedWaitersFromSnapshots(prevData, newData) {
  const prev = safeList(prevData?.waitingList);
  const next = safeList(newData?.waitingList);
  const had = idSet(prev);
  return next.filter((w) => w._id != null && !had.has(String(w._id)));
}

function mobilesLine(person) {
  const m = (person?.customerMobiles || []).map((x) => String(x).trim()).filter(Boolean);
  return m.length ? m.join(', ') : '—';
}

function phoneList(person) {
  return (person?.customerMobiles || []).map((x) => String(x).trim()).filter(Boolean);
}

function normStr(s) {
  return String(s ?? '').trim();
}

/** New remark subdoc(s) in `next` vs `prev` — returns text of the added note (most recent if several). */
function findAddedRemarkText(prevPerson, nextPerson) {
  const prevE = getRemarkEntries(prevPerson);
  const nextE = getRemarkEntries(nextPerson);
  const prevIdSet = new Set(
    prevE.filter((e) => e._id != null).map((e) => String(e._id)),
  );
  const brandNew = nextE.filter((e) => e._id != null && !prevIdSet.has(String(e._id)));
  if (brandNew.length === 1) return normStr(brandNew[0].text);
  if (brandNew.length > 1) {
    const sorted = brandNew.slice().sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    );
    return normStr(sorted[0].text);
  }
  if (prevE.length < nextE.length) {
    const tail = nextE.slice(prevE.length);
    const last = tail[tail.length - 1];
    if (last) return normStr(last.text);
  }
  return '';
}

/** Same remark id, text changed — return the new text only. */
function findUpdatedRemarkText(prevPerson, nextPerson) {
  const prevE = getRemarkEntries(prevPerson);
  const nextE = getRemarkEntries(nextPerson);
  const prevMap = new Map();
  prevE.forEach((e) => {
    if (e._id != null) prevMap.set(String(e._id), e);
  });
  for (const ne of nextE) {
    if (ne._id == null) continue;
    const pe = prevMap.get(String(ne._id));
    if (!pe) continue;
    if (normStr(pe.text) !== normStr(ne.text)) return normStr(ne.text);
  }
  return '';
}

function lastRemarkText(person) {
  const e = getRemarkEntries(person);
  if (!e.length) return '';
  return normStr(e[e.length - 1].text);
}

function advanceComparable(v) {
  if (v === '' || v == null || v === undefined) return '';
  const n = Number(v);
  return Number.isNaN(n) ? String(v) : String(n);
}

function advanceDisplay(v) {
  if (v === '' || v == null || v === undefined) return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return `Rs. ${n.toLocaleString()}`;
}

/**
 * Field-level diff for Updated Waiter / Updated Booking (only changed fields).
 * @returns {{ label: string; value: string; changed?: boolean; phones?: string[] }[]}
 */
export function buildPersonDiffLines(prev, next) {
  const lines = [];
  if (!prev || !next) return lines;

  if (normStr(prev.customerName) !== normStr(next.customerName)) {
    lines.push({
      label: 'Name',
      value: `${normStr(prev.customerName) || '—'} → ${normStr(next.customerName) || '—'}`,
      changed: true,
    });
  }

  const prevM = mobilesLine(prev);
  const nextM = mobilesLine(next);
  if (prevM !== nextM) {
    const phones = [
      ...new Set([...phoneList(prev), ...phoneList(next)].filter(Boolean)),
    ];
    lines.push({
      label: 'Mobile numbers',
      value: `${prevM} → ${nextM}`,
      changed: true,
      phones,
    });
  }

  if (normStr(prev.customerAddress) !== normStr(next.customerAddress)) {
    lines.push({
      label: 'Address',
      value: `${normStr(prev.customerAddress) || '—'} → ${normStr(next.customerAddress) || '—'}`,
      changed: true,
    });
  }

  if (normalizeCustomerCategory(prev.customerCategory) !== normalizeCustomerCategory(next.customerCategory)) {
    lines.push({
      label: 'Customer type',
      value: `${labelForCustomerCategory(prev.customerCategory)} → ${labelForCustomerCategory(next.customerCategory)}`,
      changed: true,
    });
  }

  const prevNotes = formatRemarkLogForExport(prev);
  const nextNotes = formatRemarkLogForExport(next);
  if (prevNotes !== nextNotes) {
    lines.push({
      label: 'Notes',
      value: `Was:\n${prevNotes}\n\nNow:\n${nextNotes}`,
      changed: true,
    });
  }

  if (advanceComparable(prev.advanceAmount) !== advanceComparable(next.advanceAmount)) {
    lines.push({
      label: 'Advance',
      value: `${advanceDisplay(prev.advanceAmount)} → ${advanceDisplay(next.advanceAmount)}`,
      changed: true,
    });
  }

  if (normStr(prev.paymentMode) !== normStr(next.paymentMode)) {
    lines.push({
      label: 'Payment mode',
      value: `${normStr(prev.paymentMode) || '—'} → ${normStr(next.paymentMode) || '—'}`,
      changed: true,
    });
  }

  if (normStr(prev.paymentTo) !== normStr(next.paymentTo)) {
    lines.push({
      label: 'Paid to',
      value: `${normStr(prev.paymentTo) || '—'} → ${normStr(next.paymentTo) || '—'}`,
      changed: true,
    });
  }

  const prevPhoto = normStr(prev.customerPhoto);
  const nextPhoto = normStr(next.customerPhoto);
  if (prevPhoto !== nextPhoto) {
    const v =
      prevPhoto && nextPhoto
        ? 'Photo URL updated'
        : `${prevPhoto ? 'Had photo' : 'No photo'} → ${nextPhoto ? 'Has photo' : 'No photo'}`;
    lines.push({ label: 'Customer photo', value: v, changed: true });
  }

  return lines;
}

/**
 * @param {object} person — waiter or bookingDetails-shaped object
 * @param {{
 *   personKind?: 'waiting' | 'booking';
 *   extraLines?: { label: string; value: string }[];
 * }} opts
 * @returns {{ label: string; value: string; phones?: string[]; changed?: boolean }[]}
 */
export function buildPersonSnapshotLines(person, opts = {}) {
  const kind = opts.personKind === 'booking' ? 'booking' : 'waiting';
  const byLabel = kind === 'booking' ? 'Booking By' : 'Waiting By';
  const atLabel = kind === 'booking' ? 'Booked at' : 'Waiting at';

  const lines = [];
  const phones = phoneList(person);
  lines.push({ label: 'Name', value: String(person?.customerName || '').trim() || '—' });
  lines.push({
    label: 'Mobile numbers',
    value: phones.length ? phones.join(', ') : '—',
    phones,
  });
  lines.push({ label: 'Customer type', value: labelForCustomerCategory(person?.customerCategory) });
  const addr = String(person?.customerAddress || '').trim();
  if (addr) lines.push({ label: 'Address', value: addr });
  const notes = formatRemarkLogForExport(person);
  if (notes && notes !== '-') lines.push({ label: 'Notes', value: notes });
  const createdBy = String(person?.createdBy || '').trim();
  if (createdBy) lines.push({ label: byLabel, value: nameOnly(createdBy) });
  if (person?.createdAt) lines.push({ label: atLabel, value: formatDateTime(person.createdAt) });
  const adv = person?.advanceAmount;
  if (adv != null && adv !== '') {
    lines.push({ label: 'Advance', value: `Rs. ${Number(adv).toLocaleString()}` });
  }
  const pm = String(person?.paymentMode || '').trim();
  if (pm) lines.push({ label: 'Payment mode', value: pm });
  const pt = String(person?.paymentTo || '').trim();
  if (pt) lines.push({ label: 'Paid to', value: pt });
  if (person?.isFullAdvanceReceived) {
    lines.push({ label: 'Full advance', value: 'Received' });
    const by = nameOnly(String(person?.fullAdvanceReceivedBy || '').trim());
    if (by && by !== '-') lines.push({ label: 'Confirmed by', value: by });
    if (person?.fullAdvanceReceivedAt) {
      lines.push({ label: 'Confirmed at', value: formatDateTime(person.fullAdvanceReceivedAt) });
    }
  }
  if (opts.extraLines?.length) lines.push(...opts.extraLines);
  return lines;
}

function findWaiterById(list, id) {
  return safeList(list).find((w) => String(w._id) === String(id));
}

/**
 * @returns {{ title: string | null; lines: { label: string; value: string; phones?: string[]; changed?: boolean }[] }[]}
 */
export function getActivityHistoryDetailBlocks(item) {
  const action = item?.action;
  const prev = item?.prevData || {};
  const next = item?.newData || {};
  const hasSnapshots =
    (prev && typeof prev === 'object' && (prev.waitingList || prev.bookingDetails)) ||
    (next && typeof next === 'object' && (next.waitingList || next.bookingDetails));

  /** @type {{ title: string | null; lines: { label: string; value: string; phones?: string[]; changed?: boolean }[] }[]} */
  const blocks = [];

  if (action === 'Removed Waiting' || action === 'Removed Waiter') {
    const removed = removedWaitersFromSnapshots(prev, next);
    const list =
      removed.length > 0
        ? removed
        : [
            {
              customerName: item.customerName,
              customerMobiles: item.customerMobile && item.customerMobile !== '-' ? [item.customerMobile] : [],
            },
          ];
    const removalBy = nameOnly(String(item.changedBy || '').trim()) || '—';
    const removalReason = String(item.removalRemarks || '').trim();
    list.forEach((w, i) => {
      const extra = [
        { label: 'Removed by', value: removalBy },
        ...(removalReason ? [{ label: 'Removal reason', value: removalReason }] : []),
      ];
      blocks.push({
        title: list.length > 1 ? `Removed from queue (${i + 1} of ${list.length})` : 'Removed from queue',
        lines: buildPersonSnapshotLines(w, { personKind: 'waiting', extraLines: extra }),
      });
    });
    return blocks;
  }

  if (action === 'Added to Waiting List') {
    const added = addedWaitersFromSnapshots(prev, next);
    const fallback = safeList(next.waitingList).slice(-1);
    const list = added.length > 0 ? added : fallback;
    const loggedBy = nameOnly(String(item.changedBy || '').trim()) || '—';
    list.forEach((w, i) => {
      blocks.push({
        title: list.length > 1 ? `Added to queue (${i + 1} of ${list.length})` : 'Added to waiting list',
        lines: buildPersonSnapshotLines(w, {
          personKind: 'waiting',
          extraLines: [{ label: 'Logged by', value: loggedBy }],
        }),
      });
    });
    return blocks;
  }

  if (action === 'Marked Vacant') {
    const actionBy = nameOnly(String(item.changedBy || '').trim()) || '—';
    const removalReason = String(item.removalRemarks || '').trim();

    if (prev.bookingDetails) {
      blocks.push({
        title: 'Booking cleared (was on this plot)',
        lines: buildPersonSnapshotLines(prev.bookingDetails, {
          personKind: 'booking',
          extraLines: [{ label: 'Action by', value: actionBy }],
        }),
      });
    }

    const cleared = safeList(prev.waitingList);
    if (cleared.length > 0) {
      cleared.forEach((w, i) => {
        blocks.push({
          title:
            cleared.length > 1
              ? `Was in queue (${i + 1} of ${cleared.length})`
              : 'Waiting list cleared',
          lines: buildPersonSnapshotLines(w, { personKind: 'waiting' }),
        });
      });
      const footerLines = [
        ...(removalReason ? [{ label: 'Reason / notes', value: removalReason }] : []),
        { label: 'Action by', value: actionBy },
      ];
      blocks.push({ title: null, lines: footerLines });
    }

    if (!prev.bookingDetails && cleared.length === 0) {
      const footerLines = [
        ...(removalReason ? [{ label: 'Reason / notes', value: removalReason }] : []),
        { label: 'Action by', value: actionBy },
      ];
      blocks.push({
        title: 'Plot marked OPEN',
        lines: footerLines.length ? footerLines : [{ label: 'Action by', value: actionBy }],
      });
    }

    return blocks;
  }

  if (action === 'Updated Waiter') {
    const prevList = safeList(prev.waitingList);
    const nextList = safeList(next.waitingList);
    for (const nw of nextList) {
      const pw = findWaiterById(prevList, nw._id);
      if (!pw) continue;
      const diffLines = buildPersonDiffLines(pw, nw);
      const savedBy = nameOnly(String(item.changedBy || '').trim()) || '—';
      const linesOut = [
        ...(diffLines.length === 0
          ? [
              {
                label: 'Details',
                value: 'No contact, notes, or payment text fields changed in this save.',
                changed: false,
              },
            ]
          : diffLines),
        { label: 'Saved by', value: savedBy, changed: false },
      ];
      blocks.push({ title: 'What changed', lines: linesOut });
      break;
    }
    return blocks;
  }

  if (action === 'Updated Booking' && prev.bookingDetails && next.bookingDetails) {
    const diffLines = buildPersonDiffLines(prev.bookingDetails, next.bookingDetails);
    const savedBy = nameOnly(String(item.changedBy || '').trim()) || '—';
    const linesOut = [
      ...(diffLines.length === 0
        ? [
            {
              label: 'Details',
              value: 'No contact, notes, or payment text fields changed in this save.',
              changed: false,
            },
          ]
        : diffLines),
      { label: 'Saved by', value: savedBy, changed: false },
    ];
    blocks.push({ title: 'What changed', lines: linesOut });
    return blocks;
  }

  if (
    (action === 'Marked Full Advance Received' || action === 'Unmarked Full Advance Received') &&
    next.bookingDetails
  ) {
    const bd = next.bookingDetails;
    const isReceived = Boolean(bd.isFullAdvanceReceived);
    const amount = bd.advanceAmount != null && !Number.isNaN(Number(bd.advanceAmount))
      ? `Rs. ${Number(bd.advanceAmount).toLocaleString()}`
      : 'No Advance Value Known : Error';
    const by = nameOnly(String(bd.fullAdvanceReceivedBy || item.changedBy || '').trim()) || '—';
    const at = bd.fullAdvanceReceivedAt ? formatDateTime(bd.fullAdvanceReceivedAt) : '—';
    blocks.push({
      title: 'Full advance status',
      lines: [
        { label: 'Status', value: isReceived ? 'Received' : 'Not marked', changed: true },
        { label: 'Advance amount', value: amount, changed: false },
        ...(isReceived
          ? [
              { label: 'Confirmed by', value: by, changed: false },
              { label: 'Confirmed at', value: at, changed: false },
            ]
          : []),
      ],
    });
    return blocks;
  }

  if (action === 'Added Waiting Note' || action === 'Updated Waiting Note') {
    const prevList = safeList(prev.waitingList);
    const nextList = safeList(next.waitingList);
    const savedBy = nameOnly(String(item.changedBy || '').trim()) || '—';
    for (const nw of nextList) {
      const pw = findWaiterById(prevList, nw._id);
      if (!pw) continue;
      if (formatRemarkLogForExport(pw) === formatRemarkLogForExport(nw)) continue;
      const noteText =
        action === 'Added Waiting Note'
          ? findAddedRemarkText(pw, nw) || lastRemarkText(nw)
          : findUpdatedRemarkText(pw, nw) || lastRemarkText(nw);
      blocks.push({
        title: action === 'Added Waiting Note' ? 'Waiting note added' : 'Waiting note updated',
        lines: [
          {
            label: action === 'Added Waiting Note' ? 'New note' : 'Note',
            value: noteText || '—',
            changed: false,
          },
          { label: 'Saved by', value: savedBy, changed: false },
        ],
      });
      return blocks;
    }
    blocks.push({
      title: 'Waiting notes',
      lines: [{ label: 'Saved by', value: savedBy, changed: false }],
    });
    return blocks;
  }

  if (
    (action === 'Added Booking Note' || action === 'Updated Booking Note') &&
    prev.bookingDetails &&
    next.bookingDetails
  ) {
    const pb = prev.bookingDetails;
    const nb = next.bookingDetails;
    const savedBy = nameOnly(String(item.changedBy || '').trim()) || '—';
    const noteText =
      action === 'Added Booking Note'
        ? findAddedRemarkText(pb, nb) || lastRemarkText(nb)
        : findUpdatedRemarkText(pb, nb) || lastRemarkText(nb);
    blocks.push({
      title: action === 'Added Booking Note' ? 'Booking note added' : 'Booking note updated',
      lines: [
        {
          label: action === 'Added Booking Note' ? 'New note' : 'Note',
          value: noteText || '—',
          changed: false,
        },
        { label: 'Saved by', value: savedBy, changed: false },
      ],
    });
    return blocks;
  }

  if (action === 'Transferred To') {
    const peer = String(item.transferPeerPlotNumber || '').trim() || '—';
    const head = [
      {
        label: 'Destination plot',
        value: `Plot No. ${peer}`,
        changed: false,
      },
    ];
    const title = `Transferred to Plot No. ${peer}`;
    if (prev.bookingDetails && !next.bookingDetails) {
      blocks.push({
        title,
        lines: [
          ...head,
          ...buildPersonSnapshotLines(prev.bookingDetails, { personKind: 'booking' }),
        ],
      });
      return blocks;
    }
    const removed = removedWaitersFromSnapshots(prev, next);
    removed.forEach((w, i) => {
      blocks.push({
        title: removed.length > 1 ? `${title} (${i + 1} of ${removed.length})` : title,
        lines: [
          ...(i === 0 ? head : []),
          ...buildPersonSnapshotLines(w, { personKind: 'waiting' }),
        ],
      });
    });
    if (blocks.length) return blocks;
    blocks.push({ title, lines: head });
    return blocks;
  }

  if (action === 'Transferred From') {
    const peer = String(item.transferPeerPlotNumber || '').trim() || '—';
    const head = [
      {
        label: 'Source plot',
        value: `Plot No. ${peer}`,
        changed: false,
      },
    ];
    const title = `Transferred from Plot No. ${peer}`;
    if (next.bookingDetails && !prev.bookingDetails) {
      blocks.push({
        title,
        lines: [
          ...head,
          ...buildPersonSnapshotLines(next.bookingDetails, { personKind: 'booking' }),
        ],
      });
      return blocks;
    }
    const added = addedWaitersFromSnapshots(prev, next);
    added.forEach((w, i) => {
      blocks.push({
        title: added.length > 1 ? `${title} (${i + 1} of ${added.length})` : title,
        lines: [
          ...(i === 0 ? head : []),
          ...buildPersonSnapshotLines(w, { personKind: 'waiting' }),
        ],
      });
    });
    if (blocks.length) return blocks;
    blocks.push({ title, lines: head });
    return blocks;
  }

  if (action === 'Booked' && next.bookingDetails) {
    const bd = next.bookingDetails;
    const extra = [];
    if (!String(bd.createdBy || '').trim()) {
      extra.push({
        label: 'Booking By',
        value: nameOnly(String(item.changedBy || '').trim()) || '—',
      });
    }
    blocks.push({
      title: 'Booking details',
      lines: buildPersonSnapshotLines(bd, { personKind: 'booking', extraLines: extra }),
    });
    return blocks;
  }

  if (!hasSnapshots) return blocks;

  return blocks;
}

function scanCustomerBits(data, acc) {
  if (!data || typeof data !== 'object') return;
  const bd = data.bookingDetails;
  if (bd) {
    if (bd.customerName) acc.push(bd.customerName);
    acc.push(labelForCustomerCategory(bd.customerCategory));
    (bd.customerMobiles || []).forEach((m) => {
      if (m != null && String(m).trim()) acc.push(m);
    });
    if (bd.remarks) acc.push(bd.remarks);
    for (const e of safeList(bd.remarkLog)) {
      if (e?.text) acc.push(e.text);
    }
  }
  for (const w of safeList(data.waitingList)) {
    if (w.customerName) acc.push(w.customerName);
    acc.push(labelForCustomerCategory(w.customerCategory));
    (w.customerMobiles || []).forEach((m) => {
      if (m != null && String(m).trim()) acc.push(m);
    });
    if (w.remarks) acc.push(w.remarks);
    for (const e of safeList(w.remarkLog)) {
      if (e?.text) acc.push(e.text);
    }
  }
}

/** Lowercase blob for filtering activity rows by any name/mobile in snapshots. */
export function activityLogCustomerSearchBlob(item) {
  const acc = [];
  if (item?.customerName) acc.push(item.customerName);
  if (item?.customerMobile) acc.push(item.customerMobile);
  if (item?.removalRemarks) acc.push(item.removalRemarks);
  if (item?.refundDetails?.remarks) acc.push(item.refundDetails.remarks);
  scanCustomerBits(item?.prevData, acc);
  scanCustomerBits(item?.newData, acc);
  return acc
    .map((x) => String(x).trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

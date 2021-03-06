export class Document {
    constructor({ siteId, text, history }: any);
    siteId: any;
    nextSequenceNumber: any;
    splitTreesBySpliceId: any;
    deletionsBySpliceId: any;
    undoCountsBySpliceId: any;
    markerLayersBySiteId: any;
    deferredOperationsByDependencyId: any;
    deferredResolutionsByDependencyId: any;
    deferredMarkerUpdates: any;
    deferredMarkerUpdatesByDependencyId: any;
    maxSeqsBySite: any;
    operations: any;
    undoStack: any;
    redoStack: any;
    nextCheckpointId: any;
    documentTree: any;
    addOperationDependency(map: any, dependencyId: any, op: any): void;
    applyGroupingInterval(groupingInterval: any): void;
    canIntegrateOperation(op: any): any;
    canResolveLogicalRange({ startDependencyId, endDependencyId }: any): any;
    clearRedoStack(): void;
    clearUndoStack(): void;
    collectDeferredOperations({ spliceId }: any, operations: any): void;
    collectOperationsSinceCheckpoint(checkpointId: any, deleteOperations: any, deleteCheckpoint: any): any;
    collectSegments(spliceIdString: any, segments: any, segmentIndices: any, segmentStartPositions: any): void;
    computeChangesForSegments(segmentIndices: any, segmentStartPositions: any, oldUndoCounts: any, newOperations: any): any;
    createCheckpoint(options?: any): any;
    deferMarkerUpdate(siteId: any, layerId: any, markerId: any, markerUpdate: any): void;
    deferOperation(op: any): void;
    findLocalSegmentBoundary(position: any): any;
    findSegment(position: any, preferStart: any): any;
    findSegmentEnd(spliceId: any, offset: any): any;
    findSegmentStart(spliceId: any, offset: any): any;
    getChangesSinceCheckpoint(checkpointId: any): any;
    getHistory(maxEntries: any): any;
    getLogicalRange({ start, end }: any, exclusive: any): any;
    getMarkerLayersForSiteId(siteId: any): any;
    getMarkers(): any;
    getNow(): any;
    getOperations(): any;
    getText(): any;
    groupChangesSinceCheckpoint(checkpointId: any, options: any): any;
    groupLastChanges(): any;
    hasAppliedSplice(spliceId: any): any;
    insert(spliceId: any, position: any, text: any): any;
    integrateDeferredMarkerUpdates(markerUpdates: any, { spliceId }: any): void;
    integrateDeletion(spliceId: any, deletion: any): void;
    integrateInsertion(spliceId: any, operation: any): void;
    integrateMarkerUpdate(markerUpdates: any, siteId: any, layerId: any, markerId: any, update: any): void;
    integrateMarkerUpdates(markerUpdates: any, { siteId, updates }: any): void;
    integrateOperations(operations: any): any;
    integrateUndo({ spliceId, undoCount }: any, oldUndoCounts: any): any;
    isBarrierPresentBeforeCheckpoint(checkpointId: any): any;
    isSegmentDeleted(segment: any, undoCountOverrides: any, operationsToIgnore: any): any;
    isSegmentVisible(segment: any, undoCountOverrides: any, operationsToIgnore: any): any;
    isSpliceUndone({ spliceId }: any): any;
    markersFromSnapshot(snapshot: any): any;
    populateHistory({ baseText, nextCheckpointId, undoStack, redoStack }: any): void;
    redo(): any;
    replicate(siteId: any): Document;
    resolveLogicalPosition(spliceId: any, offset: any, preferStart: any): any;
    resolveLogicalRange(logicalRange: any, exclusive: any): any;
    revertToCheckpoint(checkpointId: any, options: any): any;
    setTextInRange(start: any, end: any, text: any, options?: any): any;
    snapshotFromMarkers(layersById: any): any;
    splitSegment(splitTree: any, segment: any, offset: any): any;
    textUpdatesForOperations(operations: any, oldUndoCounts: any): any;
    undo(): any;
    undoOrRedoOperations(operationsToUndo: any): any;
    updateMarkers(layerUpdatesById: any): any;
    updateMarkersForOperations(operations: any): any;
    updateMaxSeqsBySite({ site, seq }: any): void;
    updateUndoCount(spliceId: any, newUndoCount: any, oldUndoCounts: any): void;
}
export function deserializeOperation(operationMessage: any): any;
export const deserializeRemotePosition: any;
export function serializeOperation(op: any): any;
export const serializeRemotePosition: any;

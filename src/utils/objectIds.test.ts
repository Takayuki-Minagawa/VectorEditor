import * as fabric from 'fabric';
import { describe, expect, it } from 'vitest';
import { getFabricMetadata, setFabricMetadataValues } from './fabricObjectMetadata';
import {
  reassignObjectIdsAndReferences,
  reassignObjectIdsRecursive,
  translateSemanticAnchors,
} from './objectIds';

describe('reassignObjectIdsAndReferences', () => {
  it('repairs linked dimension and connector anchors after cloning a graph', () => {
    const first = new fabric.Rect({ left: 0, top: 0, width: 20, height: 20 });
    const second = new fabric.Rect({ left: 100, top: 0, width: 20, height: 20 });
    const dimension = new fabric.Group([new fabric.Line([0, 0, 100, 0])]);
    const connector = new fabric.Group([new fabric.Line([0, 0, 100, 0])]);
    setFabricMetadataValues(first, { id: 'first', objectKind: 'rect' });
    setFabricMetadataValues(second, { id: 'second', objectKind: 'rect' });
    setFabricMetadataValues(dimension, {
      id: 'dimension',
      objectKind: 'dimension',
      dimensionData: {
        start: { x: 0, y: 0, objectId: 'first', anchor: 'center' },
        end: { x: 100, y: 0, objectId: 'second', anchor: 'center' },
      },
    });
    setFabricMetadataValues(connector, {
      id: 'connector',
      objectKind: 'connector',
      connectorData: {
        from: { x: 0, y: 0, objectId: 'first', anchor: 'center' },
        to: { x: 100, y: 0, objectId: 'second', anchor: 'center' },
        route: 'straight',
      },
    });

    const map = reassignObjectIdsAndReferences([first, second, dimension, connector]);
    const dimensionData = getFabricMetadata(dimension).dimensionData;
    const connectorData = getFabricMetadata(connector).connectorData;
    expect(dimensionData?.start.objectId).toBe(map.get('first'));
    expect(dimensionData?.end.objectId).toBe(map.get('second'));
    expect(connectorData?.from.objectId).toBe(map.get('first'));
    expect(connectorData?.to.objectId).toBe(map.get('second'));
  });

  it('drops external semantic references for a self-contained symbol graph', () => {
    const connector = new fabric.Group([new fabric.Line([0, 0, 100, 0])]);
    setFabricMetadataValues(connector, {
      id: 'connector',
      objectKind: 'connector',
      connectorData: {
        from: { x: 10, y: 20, objectId: 'outside', anchor: 'center' },
        to: { x: 100, y: 20 },
        route: 'straight',
      },
    });

    reassignObjectIdsAndReferences([connector], { dropExternalReferences: true });
    translateSemanticAnchors([connector], 20, 30);

    expect(getFabricMetadata(connector).connectorData?.from).toEqual({ x: 30, y: 50 });
    expect(getFabricMetadata(connector).connectorData?.to).toEqual({ x: 120, y: 50 });
  });

  it('overwrites source SVG ids so repeated imports cannot collide', () => {
    const firstImport = new fabric.Rect({ width: 20, height: 20 });
    const secondImport = new fabric.Rect({ width: 20, height: 20 });
    setFabricMetadataValues(firstImport, { id: 'svg-element' });
    setFabricMetadataValues(secondImport, { id: 'svg-element' });

    reassignObjectIdsRecursive(firstImport);
    reassignObjectIdsRecursive(secondImport);

    const firstId = getFabricMetadata(firstImport).id;
    const secondId = getFabricMetadata(secondImport).id;
    expect(firstId).not.toBe('svg-element');
    expect(secondId).not.toBe('svg-element');
    expect(firstId).not.toBe(secondId);
  });
});

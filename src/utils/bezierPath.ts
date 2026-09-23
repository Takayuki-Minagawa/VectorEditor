export interface BezierPoint { x: number; y: number }
export interface BezierNode extends BezierPoint {
  incoming?: BezierPoint;
  outgoing?: BezierPoint;
  mode: 'cusp' | 'smooth' | 'symmetric';
}

export function bezierPathData(nodes: readonly BezierNode[], closed = false, preview?: BezierPoint): string {
  if (!nodes.length) return '';
  const commands = [`M ${nodes[0].x} ${nodes[0].y}`];
  const segment = (from: BezierNode, to: BezierNode) => {
    if (from.outgoing || to.incoming) {
      const a = from.outgoing ?? from;
      const b = to.incoming ?? to;
      commands.push(`C ${a.x} ${a.y} ${b.x} ${b.y} ${to.x} ${to.y}`);
    } else commands.push(`L ${to.x} ${to.y}`);
  };
  for (let i = 1; i < nodes.length; i++) segment(nodes[i - 1], nodes[i]);
  if (closed && nodes.length >= 3) { segment(nodes[nodes.length - 1], nodes[0]); commands.push('Z'); }
  else if (preview) segment(nodes[nodes.length - 1], { ...preview, mode: 'cusp' });
  return commands.join(' ');
}

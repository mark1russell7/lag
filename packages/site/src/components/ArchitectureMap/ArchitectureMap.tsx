import {
    Background,
    Controls,
    Handle,
    MarkerType,
    Position,
    ReactFlow,
    type Edge,
    type Node,
    type NodeProps,
    type OnSelectionChangeParams,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router";
import {
    LAYER_LABELS,
    LAYER_SHAPES,
    architectureEdges,
    architectureNodes,
    type ArchEdgeSpec,
    type ArchLayer,
    type ArchNodeSpec,
    type ArchSide,
} from "../../architecture/graph";
import { InlineCode, plainText } from "../../lib/InlineCode";
import { useTheme } from "../../theme/ThemeProvider";
import styles from "./ArchitectureMap.module.css";

type ArchNodeData = { spec : ArchNodeSpec };
type ArchFlowNode = Node<ArchNodeData, "arch" | "archGroup">;

const SIDES : ReadonlyArray<[ArchSide, Position]> = [
    ["top", Position.Top],
    ["right", Position.Right],
    ["bottom", Position.Bottom],
    ["left", Position.Left],
];

/** A source and a target handle on each side, so each edge can choose its sides. */
function Handles() {
    return (
        <>
            {SIDES.map(([side, position]) => (
                <Handle key={`target-${side}`} id={`target-${side}`} type="target" position={position} isConnectable={false} className={styles.handle} />
            ))}
            {SIDES.map(([side, position]) => (
                <Handle key={`source-${side}`} id={`source-${side}`} type="source" position={position} isConnectable={false} className={styles.handle} />
            ))}
        </>
    );
}

function ArchNodeView({ data, selected } : NodeProps<ArchFlowNode>) {
    return (
        <div className={styles.node} data-layer={data.spec.layer} data-selected={selected ? "true" : undefined}>
            <Handles />
            <span className={styles.nodeLabel}>{data.spec.label}</span>
        </div>
    );
}

function ArchGroupView({ data, selected } : NodeProps<ArchFlowNode>) {
    return (
        <div className={styles.group} data-selected={selected ? "true" : undefined}>
            <Handles />
            <span className={styles.groupLabel}>{data.spec.label}</span>
        </div>
    );
}

// Outside the component: React Flow needs a stable object.
const nodeTypes = { arch : ArchNodeView, archGroup : ArchGroupView };

function toFlowNodes(specs : readonly ArchNodeSpec[]) : ArchFlowNode[] {
    // React Flow needs each parent before its children.
    const ordered = [...specs.filter(spec => !spec.parent), ...specs.filter(spec => spec.parent)];
    return ordered.map((spec) : ArchFlowNode => ({
        id : spec.id,
        type : spec.size ? "archGroup" : "arch",
        position : spec.position,
        data : { spec },
        draggable : false,
        connectable : false,
        ariaLabel : `${spec.label} (${LAYER_LABELS[spec.layer].toLowerCase()}): ${plainText(spec.description)}`,
        ...(spec.parent ? { parentId : spec.parent, extent : "parent" as const } : {}),
        ...(spec.size ? { style : { width : spec.size.width, height : spec.size.height }, zIndex : -1 } : {}),
    }));
}

function toFlowEdges(specs : readonly ArchEdgeSpec[], labels : ReadonlyMap<string, string>) : Edge[] {
    return specs.map((spec) : Edge => ({
        id : `${spec.source}->${spec.target}`,
        source : spec.source,
        target : spec.target,
        sourceHandle : `source-${spec.from ?? "bottom"}`,
        targetHandle : `target-${spec.to ?? "top"}`,
        type : "smoothstep",
        markerEnd : { type : MarkerType.ArrowClosed, width : 16, height : 16 },
        focusable : false,
        ariaLabel : `${labels.get(spec.source) ?? spec.source} ${spec.label ?? "connects to"} ${labels.get(spec.target) ?? spec.target}`,
        ...(spec.label && !spec.hideLabel ? { label : spec.label } : {}),
    }));
}

/** The arrows that start at a node, as "Target (relation)". */
function connectionsOf(id : string, edges : readonly ArchEdgeSpec[], labels : ReadonlyMap<string, string>) : string[] {
    return edges
        .filter(edge => edge.source === id)
        .map(edge => {
            const target = labels.get(edge.target) ?? edge.target;
            return edge.label ? `${target} (${edge.label})` : target;
        });
}

export type ArchitectureMapProps = {
    nodes? : readonly ArchNodeSpec[];
    edges? : readonly ArchEdgeSpec[];
};

/**
 * An interactive map of the system. Select a box (click it, or press Tab and
 * then Enter) to see what it does. A list under the map gives the same
 * information as text.
 */
export function ArchitectureMap({ nodes = architectureNodes, edges = architectureEdges } : ArchitectureMapProps) {
    const { resolved } = useTheme();
    const [selectedId, setSelectedId] = useState<string>();
    const labels = useMemo(() => new Map(nodes.map(node => [node.id, node.label])), [nodes]);
    const flowNodes = useMemo(() => toFlowNodes(nodes), [nodes]);
    const flowEdges = useMemo(() => toFlowEdges(edges, labels), [edges, labels]);
    const selected = nodes.find(node => node.id === selectedId);

    const onSelectionChange = useCallback(({ nodes : picked } : OnSelectionChangeParams) => {
        setSelectedId(picked[0]?.id);
    }, []);

    return (
        <div className={styles.map}>
            <div className={styles.layout}>
                <div className={styles.canvas}>
                    <ReactFlow
                        nodes={flowNodes}
                        edges={flowEdges}
                        nodeTypes={nodeTypes}
                        colorMode={resolved}
                        fitView
                        fitViewOptions={{ padding : 0.08 }}
                        minZoom={0.3}
                        maxZoom={1.6}
                        nodesDraggable={false}
                        nodesConnectable={false}
                        edgesFocusable={false}
                        zoomOnScroll={false}
                        preventScrolling={false}
                        onSelectionChange={onSelectionChange}
                    >
                        <Background gap={16} size={1} />
                        <Controls showInteractive={false} />
                    </ReactFlow>
                </div>
                <aside className={styles.panel} aria-live="polite" aria-label="Selected part">
                    {selected ? (
                        <>
                            <p className={styles.panelLayer}>{LAYER_LABELS[selected.layer]}</p>
                            <p className={styles.panelTitle}>{selected.label}</p>
                            <p className={styles.panelText}><InlineCode text={selected.description} /></p>
                            {connectionsOf(selected.id, edges, labels).length > 0 ? (
                                <>
                                    <p className={styles.panelSubtitle}>Arrows to</p>
                                    <ul className={styles.panelList}>
                                        {connectionsOf(selected.id, edges, labels).map(text => <li key={text}>{text}</li>)}
                                    </ul>
                                </>
                            ) : null}
                            {selected.docs ? <Link to={selected.docs}>Read about {selected.label}</Link> : null}
                        </>
                    ) : (
                        <p className={styles.panelText}>
                            Select a box to see what it does. To use the keyboard, press Tab to go to a box, then press Enter.
                        </p>
                    )}
                </aside>
            </div>
            <p className={styles.legend}>
                {(Object.keys(LAYER_SHAPES) as ArchLayer[])
                    .map(layer => `${LAYER_LABELS[layer]}: ${LAYER_SHAPES[layer]}.`)
                    .join(" ")}{" "}
                An arrow points from the part that uses, starts or sends to the part that it acts on.
            </p>
            <details className={styles.list}>
                <summary>Show the map as a list</summary>
                <ul>
                    {nodes.map(node => (
                        <li key={node.id}>
                            <strong>{node.label}</strong> ({LAYER_LABELS[node.layer].toLowerCase()}). <InlineCode text={node.description} />
                            {connectionsOf(node.id, edges, labels).length > 0
                                ? ` Arrows to: ${connectionsOf(node.id, edges, labels).join(", ")}.`
                                : null}
                        </li>
                    ))}
                </ul>
            </details>
        </div>
    );
}

export default ArchitectureMap;

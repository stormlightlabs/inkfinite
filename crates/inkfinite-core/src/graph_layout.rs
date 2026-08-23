//! Deterministic graph-layout contracts and the native layout adapter.
//!
//! The document engine owns the graph representation and the normalized result.
//! The placement implementation is deliberately kept behind this module so a
//! Graphviz adapter can replace it without leaking DOT or engine-specific data
//! into document records.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::f64::consts::TAU;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{ShapeId, Vec2};

/// Graph layout algorithm exposed by Inkfinite.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum GraphLayoutAlgorithm {
    /// Layer a directed graph by rank.
    Flow,
    /// Layer a directed graph with tree-oriented stable ordering.
    Tree,
    /// Place graph ranks on concentric circles.
    Radial,
}

/// Direction of ranked graph layouts.
#[derive(Clone, Copy, Debug, Eq, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum GraphLayoutDirection {
    /// Sources appear above their targets.
    TopToBottom,
    /// Sources appear to the left of their targets.
    LeftToRight,
}

/// Options shared by graph layout operations.
#[derive(Clone, Copy, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct GraphLayoutOptions {
    /// Layout algorithm to use.
    pub algorithm: GraphLayoutAlgorithm,
    /// Direction for ranked layouts.
    pub direction: GraphLayoutDirection,
    /// Space between adjacent nodes in one rank or radial ring.
    pub node_gap: f64,
    /// Space between ranked rows or radial rings.
    pub rank_gap: f64,
}

impl Default for GraphLayoutOptions {
    fn default() -> Self {
        Self {
            algorithm: GraphLayoutAlgorithm::Flow,
            direction: GraphLayoutDirection::TopToBottom,
            node_gap: 64.0,
            rank_gap: 96.0,
        }
    }
}

/// A measured graph node. Positions are returned separately from dimensions.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct GraphLayoutNode {
    /// Stable shape identifier.
    pub id: ShapeId,
    /// World-space width of the shape's measured bounds.
    pub width: f64,
    /// World-space height of the shape's measured bounds.
    pub height: f64,
    /// Whether the node is a fixed layout anchor.
    pub locked: bool,
}

/// A directed structured connection between two selected nodes.
#[derive(Clone, Debug, Eq, JsonSchema, Ord, PartialEq, PartialOrd, Serialize, Deserialize, TS)]
pub struct GraphLayoutEdge {
    /// Source node identifier.
    pub source: ShapeId,
    /// Target node identifier.
    pub target: ShapeId,
}

/// Engine-neutral graph passed to the layout adapter.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct GraphLayoutGraph {
    /// Nodes in stable identifier order.
    pub nodes: Vec<GraphLayoutNode>,
    /// Directed edges in stable source/target order.
    pub edges: Vec<GraphLayoutEdge>,
}

/// Normalized node placement returned by a graph layout adapter.
#[derive(Clone, Debug, JsonSchema, PartialEq, Serialize, Deserialize, TS)]
pub struct GraphLayoutResult {
    /// Top-left world positions relative to the result origin.
    pub positions: BTreeMap<ShapeId, Vec2>,
}

/// Lays out an internal graph without retaining graph-engine state in a document.
///
/// The current adapter provides deterministic ranked and radial placement. Its
/// input and output are intentionally independent of DOT so native and browser
/// Graphviz adapters can use the same contract when available.
///
/// # Errors
///
/// Returns an error when the graph is empty, has duplicate or missing endpoints,
/// contains invalid dimensions, or uses invalid spacing.
pub fn layout_graph(graph: &GraphLayoutGraph, options: GraphLayoutOptions) -> Result<GraphLayoutResult, String> {
    validate_graph(graph, options)?;
    let positions = match options.algorithm {
        GraphLayoutAlgorithm::Flow | GraphLayoutAlgorithm::Tree => ranked_positions(graph, options),
        GraphLayoutAlgorithm::Radial => radial_positions(graph, options),
    };
    Ok(GraphLayoutResult { positions: normalize_positions(positions) })
}

fn validate_graph(graph: &GraphLayoutGraph, options: GraphLayoutOptions) -> Result<(), String> {
    if graph.nodes.is_empty() {
        return Err("graph layout requires at least one node".into());
    }
    if !options.node_gap.is_finite() || options.node_gap < 0.0 {
        return Err("graph node gap must be finite and non-negative".into());
    }
    if !options.rank_gap.is_finite() || options.rank_gap < 0.0 {
        return Err("graph rank gap must be finite and non-negative".into());
    }
    let mut ids = BTreeSet::new();
    for node in &graph.nodes {
        if !node.width.is_finite() || node.width < 0.0 || !node.height.is_finite() || node.height < 0.0 {
            return Err(format!("graph node {} has invalid dimensions", node.id));
        }
        if !ids.insert(node.id.clone()) {
            return Err(format!("graph layout contains duplicate node {}", node.id));
        }
    }
    for edge in &graph.edges {
        if !ids.contains(&edge.source) || !ids.contains(&edge.target) {
            return Err(format!(
                "graph edge {} -> {} refers to a node outside the graph",
                edge.source, edge.target
            ));
        }
    }
    Ok(())
}

fn ranked_positions(graph: &GraphLayoutGraph, options: GraphLayoutOptions) -> BTreeMap<ShapeId, Vec2> {
    let node_ids = graph.nodes.iter().map(|node| node.id.clone()).collect::<Vec<_>>();
    let index = node_ids
        .iter()
        .enumerate()
        .map(|(index, id)| (id.clone(), index))
        .collect::<BTreeMap<_, _>>();
    let mut outgoing = vec![Vec::new(); node_ids.len()];
    for edge in &graph.edges {
        let source = index[&edge.source];
        let target = index[&edge.target];
        if source != target && !outgoing[source].contains(&target) {
            outgoing[source].push(target);
        }
    }
    for targets in &mut outgoing {
        targets.sort_by(|left, right| node_ids[*left].cmp(&node_ids[*right]));
    }
    let components = strongly_connected_components(&outgoing);
    let component_count = components.iter().copied().max().map_or(0, |value| value + 1);
    let mut component_edges = vec![BTreeSet::new(); component_count];
    let mut indegree = vec![0usize; component_count];
    for (source, targets) in outgoing.iter().enumerate() {
        for target in targets {
            let source_component = components[source];
            let target_component = components[*target];
            if source_component != target_component && component_edges[source_component].insert(target_component) {
                indegree[target_component] += 1;
            }
        }
    }
    let mut queue = BTreeSet::new();
    for (component, degree) in indegree.iter().enumerate() {
        if *degree == 0 {
            queue.insert(component);
        }
    }
    let mut component_rank = vec![0usize; component_count];
    while let Some(component) = queue.pop_first() {
        for target in &component_edges[component] {
            component_rank[*target] = component_rank[*target].max(component_rank[component] + 1);
            indegree[*target] -= 1;
            if indegree[*target] == 0 {
                queue.insert(*target);
            }
        }
    }

    let mut ranks: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (node, component) in components.iter().enumerate() {
        ranks.entry(component_rank[*component]).or_default().push(node);
    }
    for nodes in ranks.values_mut() {
        nodes.sort_by(|left, right| node_ids[*left].cmp(&node_ids[*right]));
    }

    let mut positions = BTreeMap::new();
    let mut rank_cursor = 0.0;
    for nodes in ranks.values() {
        let rank_extent = nodes
            .iter()
            .map(|node| match options.direction {
                GraphLayoutDirection::TopToBottom => graph.nodes[*node].height,
                GraphLayoutDirection::LeftToRight => graph.nodes[*node].width,
            })
            .fold(0.0, f64::max);
        let mut cross_cursor = 0.0;
        for node in nodes {
            let extent = match options.direction {
                GraphLayoutDirection::TopToBottom => graph.nodes[*node].width,
                GraphLayoutDirection::LeftToRight => graph.nodes[*node].height,
            };
            let offset = match options.direction {
                GraphLayoutDirection::TopToBottom => Vec2 { x: cross_cursor, y: rank_cursor },
                GraphLayoutDirection::LeftToRight => Vec2 { x: rank_cursor, y: cross_cursor },
            };
            positions.insert(node_ids[*node].clone(), offset);
            cross_cursor += extent + options.node_gap;
        }
        rank_cursor += rank_extent + options.rank_gap;
    }
    positions
}

fn radial_positions(graph: &GraphLayoutGraph, options: GraphLayoutOptions) -> BTreeMap<ShapeId, Vec2> {
    let node_ids = graph.nodes.iter().map(|node| node.id.clone()).collect::<Vec<_>>();
    let index = node_ids
        .iter()
        .enumerate()
        .map(|(index, id)| (id.clone(), index))
        .collect::<BTreeMap<_, _>>();
    let mut outgoing = vec![Vec::new(); node_ids.len()];
    for edge in &graph.edges {
        let source = index[&edge.source];
        let target = index[&edge.target];
        if source != target && !outgoing[source].contains(&target) {
            outgoing[source].push(target);
        }
    }
    for targets in &mut outgoing {
        targets.sort_by(|left, right| node_ids[*left].cmp(&node_ids[*right]));
    }
    let mut indegree = vec![0usize; node_ids.len()];
    for targets in &outgoing {
        for target in targets {
            indegree[*target] += 1;
        }
    }
    let mut depths = vec![None; node_ids.len()];
    let mut queue = VecDeque::new();
    for (index, degree) in indegree.iter().enumerate() {
        if *degree == 0 {
            depths[index] = Some(0usize);
            queue.push_back(index);
        }
    }
    if queue.is_empty() {
        depths[0] = Some(0);
        queue.push_back(0);
    }
    while let Some(source) = queue.pop_front() {
        let depth = depths[source].unwrap_or(0);
        for target in &outgoing[source] {
            let next_depth = depth + 1;
            if depths[*target].is_none() {
                depths[*target] = Some(next_depth);
                queue.push_back(*target);
            }
        }
    }
    for depth in &mut depths {
        if depth.is_none() {
            *depth = Some(0);
        }
    }
    let max_dimension = graph
        .nodes
        .iter()
        .map(|node| node.width.max(node.height))
        .fold(0.0, f64::max);
    let radius_step = (max_dimension + options.rank_gap).max(options.node_gap + 1.0);
    let mut rings: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (index, depth) in depths.iter().enumerate() {
        rings.entry(depth.unwrap_or(0)).or_default().push(index);
    }
    for nodes in rings.values_mut() {
        nodes.sort_by(|left, right| node_ids[*left].cmp(&node_ids[*right]));
    }
    let mut positions = BTreeMap::new();
    for (depth, nodes) in rings {
        let radius = radius_step * (depth as f64 + f64::from(nodes.len() > 1));
        for (offset, node) in nodes.iter().enumerate() {
            let angle = -std::f64::consts::FRAC_PI_2 + TAU * offset as f64 / nodes.len() as f64;
            let center = Vec2 { x: radius * angle.cos(), y: radius * angle.sin() };
            positions.insert(
                node_ids[*node].clone(),
                Vec2 { x: center.x - graph.nodes[*node].width / 2.0, y: center.y - graph.nodes[*node].height / 2.0 },
            );
        }
    }
    positions
}

fn normalize_positions(mut positions: BTreeMap<ShapeId, Vec2>) -> BTreeMap<ShapeId, Vec2> {
    let min_x = positions
        .values()
        .map(|position| position.x)
        .fold(f64::INFINITY, f64::min);
    let min_y = positions
        .values()
        .map(|position| position.y)
        .fold(f64::INFINITY, f64::min);
    for position in positions.values_mut() {
        position.x -= min_x;
        position.y -= min_y;
    }
    positions
}

fn strongly_connected_components(outgoing: &[Vec<usize>]) -> Vec<usize> {
    let mut reverse = vec![Vec::new(); outgoing.len()];
    for (source, targets) in outgoing.iter().enumerate() {
        for target in targets {
            reverse[*target].push(source);
        }
    }
    for targets in &mut reverse {
        targets.sort_unstable();
    }
    let mut visited = vec![false; outgoing.len()];
    let mut order = Vec::with_capacity(outgoing.len());
    for node in 0..outgoing.len() {
        depth_first_order(node, outgoing, &mut visited, &mut order);
    }
    let mut components = vec![usize::MAX; outgoing.len()];
    let mut component = 0;
    for node in order.into_iter().rev() {
        if components[node] == usize::MAX {
            assign_component(node, &reverse, &mut components, component);
            component += 1;
        }
    }
    components
}

fn depth_first_order(node: usize, outgoing: &[Vec<usize>], visited: &mut [bool], order: &mut Vec<usize>) {
    if visited[node] {
        return;
    }
    visited[node] = true;
    for target in &outgoing[node] {
        depth_first_order(*target, outgoing, visited, order);
    }
    order.push(node);
}

fn assign_component(node: usize, reverse: &[Vec<usize>], components: &mut [usize], component: usize) {
    if components[node] != usize::MAX {
        return;
    }
    components[node] = component;
    for target in &reverse[node] {
        assign_component(*target, reverse, components, component);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(id: &str, width: f64, height: f64) -> GraphLayoutNode {
        GraphLayoutNode { id: ShapeId::from(id), width, height, locked: false }
    }

    #[test]
    fn ranked_layout_is_stable_and_respects_direction() {
        let graph = GraphLayoutGraph {
            nodes: vec![node("a", 20.0, 10.0), node("b", 30.0, 12.0), node("c", 10.0, 14.0)],
            edges: vec![
                GraphLayoutEdge { source: ShapeId::from("a"), target: ShapeId::from("b") },
                GraphLayoutEdge { source: ShapeId::from("a"), target: ShapeId::from("c") },
            ],
        };
        let top_to_bottom = layout_graph(&graph, GraphLayoutOptions::default()).unwrap();
        assert_eq!(top_to_bottom.positions[&ShapeId::from("a")].y, 0.0);
        assert!(top_to_bottom.positions[&ShapeId::from("b")].y > 0.0);
        assert!(top_to_bottom.positions[&ShapeId::from("c")].y > 0.0);

        let left_to_right = layout_graph(
            &graph,
            GraphLayoutOptions { direction: GraphLayoutDirection::LeftToRight, ..GraphLayoutOptions::default() },
        )
        .unwrap();
        assert_eq!(left_to_right.positions[&ShapeId::from("a")].x, 0.0);
        assert!(left_to_right.positions[&ShapeId::from("b")].x > 0.0);
    }

    #[test]
    fn cycles_and_disconnected_nodes_remain_layoutable() {
        let graph = GraphLayoutGraph {
            nodes: vec![node("a", 10.0, 10.0), node("b", 10.0, 10.0), node("c", 10.0, 10.0)],
            edges: vec![
                GraphLayoutEdge { source: ShapeId::from("a"), target: ShapeId::from("b") },
                GraphLayoutEdge { source: ShapeId::from("b"), target: ShapeId::from("a") },
            ],
        };
        let result = layout_graph(
            &graph,
            GraphLayoutOptions { algorithm: GraphLayoutAlgorithm::Tree, ..GraphLayoutOptions::default() },
        )
        .unwrap();
        assert_eq!(result.positions.len(), 3);
        assert!(
            result
                .positions
                .values()
                .all(|position| position.x.is_finite() && position.y.is_finite())
        );
    }
}

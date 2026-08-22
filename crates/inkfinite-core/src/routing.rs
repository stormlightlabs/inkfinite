//! Deterministic orthogonal routing for connectors.
//!
//! Routing is intentionally based on axis-aligned obstacle bounds rather than
//! renderer-specific geometry. The browser editor mirrors this algorithm for
//! pointer previews, while the native renderer uses this implementation for
//! persisted documents and exports.

use std::cmp::Ordering;

use crate::Vec2;
use crate::proto::Bounds;

const EPSILON: f64 = 1e-9;
const TURN_PENALTY: f64 = 12.0;

/// Computes a deterministic Manhattan route between two connector endpoints.
///
/// Obstacles are expanded by `padding` before the route is searched. The
/// returned path contains the endpoints and only horizontal or vertical
/// segments. When no detour is required, the route uses the same centered
/// elbow shape as the editor's previous orthogonal renderer.
#[must_use]
pub fn obstacle_aware_orthogonal_route(start: Vec2, end: Vec2, obstacles: &[Bounds], padding: f64) -> Vec<Vec2> {
    if (start.x - end.x).abs() <= EPSILON && (start.y - end.y).abs() <= EPSILON {
        return vec![start, end];
    }

    let padding = padding.max(0.0);
    let obstacles: Vec<Rect> = obstacles
        .iter()
        .filter_map(|obstacle| {
            let width = obstacle.width.abs();
            let height = obstacle.height.abs();
            if width <= EPSILON && height <= EPSILON {
                return None;
            }
            let min_x = obstacle.x.min(obstacle.x + obstacle.width) - padding;
            let max_x = obstacle.x.max(obstacle.x + obstacle.width) + padding;
            let min_y = obstacle.y.min(obstacle.y + obstacle.height) - padding;
            let max_y = obstacle.y.max(obstacle.y + obstacle.height) + padding;
            Some(Rect { min_x, max_x, min_y, max_y })
        })
        .collect();

    let fallback = centered_orthogonal_route(start, end);
    if obstacles.is_empty() || path_is_clear(&fallback, &obstacles) {
        return fallback;
    }

    let mut x_values = vec![start.x, end.x];
    let mut y_values = vec![start.y, end.y];
    for obstacle in &obstacles {
        x_values.extend([obstacle.min_x, obstacle.max_x]);
        y_values.extend([obstacle.min_y, obstacle.max_y]);
    }
    sort_unique(&mut x_values);
    sort_unique(&mut y_values);

    let mut nodes = Vec::with_capacity(x_values.len() * y_values.len() + 2);
    for x in &x_values {
        for y in &y_values {
            let point = Vec2 { x: *x, y: *y };
            if !point_is_inside(point, &obstacles) {
                nodes.push(point);
            }
        }
    }
    let start_index = ensure_node(&mut nodes, start);
    let end_index = ensure_node(&mut nodes, end);

    let mut states = vec![State::default(); nodes.len() * 3];
    states[start_index * 3 + 2].cost = 0.0;
    let mut settled = vec![false; states.len()];

    loop {
        let Some(current_state) = states
            .iter()
            .enumerate()
            .filter(|(index, state)| !settled[*index] && state.cost.is_finite())
            .min_by(|(_, left), (_, right)| {
                left.cost
                    .partial_cmp(&right.cost)
                    .unwrap_or(Ordering::Equal)
                    .then_with(|| left.node.cmp(&right.node))
                    .then_with(|| left.direction.cmp(&right.direction))
            })
            .map(|(index, _)| index)
        else {
            break;
        };
        settled[current_state] = true;
        let node_index = current_state / 3;
        let direction = current_state % 3;
        if node_index == end_index {
            return simplify_route(reconstruct_path(&states, &nodes, current_state));
        }

        for (next_index, next) in nodes.iter().enumerate() {
            if next_index == node_index || !axis_aligned(nodes[node_index], *next) {
                continue;
            }
            if !segment_is_clear(nodes[node_index], *next, &obstacles) {
                continue;
            }
            let next_direction = if (next.x - nodes[node_index].x).abs() > EPSILON { 0 } else { 1 };
            let next_state = next_index * 3 + next_direction;
            let distance = manhattan(nodes[node_index], *next);
            let turn = if direction < 2 && direction != next_direction { TURN_PENALTY } else { 0.0 };
            let cost = states[current_state].cost + distance + turn;
            if cost + EPSILON < states[next_state].cost
                || ((cost - states[next_state].cost).abs() <= EPSILON
                    && current_state < states[next_state].previous.unwrap_or(usize::MAX))
            {
                states[next_state].cost = cost;
                states[next_state].previous = Some(current_state);
                states[next_state].node = next_index;
                states[next_state].direction = next_direction;
            }
        }
    }

    fallback
}

/// Computes the centered two-elbow route used when no obstacle blocks it.
#[must_use]
pub fn centered_orthogonal_route(start: Vec2, end: Vec2) -> Vec<Vec2> {
    if (end.x - start.x).abs() <= 0.1 || (end.y - start.y).abs() <= 0.1 {
        return vec![start, end];
    }
    let middle = start.x + (end.x - start.x) / 2.0;
    vec![start, Vec2 { x: middle, y: start.y }, Vec2 { x: middle, y: end.y }, end]
}

#[derive(Clone, Copy, Debug)]
struct Rect {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
}

#[derive(Clone, Copy, Debug)]
struct State {
    cost: f64,
    previous: Option<usize>,
    node: usize,
    direction: usize,
}

impl Default for State {
    fn default() -> Self {
        Self { cost: f64::INFINITY, previous: None, node: 0, direction: 2 }
    }
}

fn sort_unique(values: &mut Vec<f64>) {
    values.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    values.dedup_by(|left, right| (*left - *right).abs() <= EPSILON);
}

fn ensure_node(nodes: &mut Vec<Vec2>, point: Vec2) -> usize {
    if let Some(index) = nodes.iter().position(|candidate| same_point(*candidate, point)) {
        return index;
    }
    nodes.push(point);
    nodes.len() - 1
}

fn same_point(left: Vec2, right: Vec2) -> bool {
    (left.x - right.x).abs() <= EPSILON && (left.y - right.y).abs() <= EPSILON
}

fn axis_aligned(left: Vec2, right: Vec2) -> bool {
    (left.x - right.x).abs() <= EPSILON || (left.y - right.y).abs() <= EPSILON
}

fn point_is_inside(point: Vec2, obstacles: &[Rect]) -> bool {
    obstacles.iter().any(|obstacle| {
        point.x > obstacle.min_x + EPSILON
            && point.x < obstacle.max_x - EPSILON
            && point.y > obstacle.min_y + EPSILON
            && point.y < obstacle.max_y - EPSILON
    })
}

fn segment_is_clear(start: Vec2, end: Vec2, obstacles: &[Rect]) -> bool {
    if !axis_aligned(start, end) {
        return false;
    }
    obstacles.iter().all(|obstacle| {
        if (start.y - end.y).abs() <= EPSILON {
            let y_inside = start.y > obstacle.min_y + EPSILON && start.y < obstacle.max_y - EPSILON;
            !y_inside || !intervals_overlap(start.x, end.x, obstacle.min_x, obstacle.max_x)
        } else {
            let x_inside = start.x > obstacle.min_x + EPSILON && start.x < obstacle.max_x - EPSILON;
            !x_inside || !intervals_overlap(start.y, end.y, obstacle.min_y, obstacle.max_y)
        }
    })
}

fn intervals_overlap(first_start: f64, first_end: f64, second_start: f64, second_end: f64) -> bool {
    first_start.min(first_end) < second_end - EPSILON && first_start.max(first_end) > second_start + EPSILON
}

fn path_is_clear(path: &[Vec2], obstacles: &[Rect]) -> bool {
    path.windows(2)
        .all(|segment| segment_is_clear(segment[0], segment[1], obstacles))
}

fn manhattan(left: Vec2, right: Vec2) -> f64 {
    (left.x - right.x).abs() + (left.y - right.y).abs()
}

fn reconstruct_path(states: &[State], nodes: &[Vec2], mut current: usize) -> Vec<Vec2> {
    let mut path = Vec::new();
    loop {
        path.push(nodes[states[current].node]);
        let Some(previous) = states[current].previous else { break };
        current = previous;
    }
    path.reverse();
    path
}

fn simplify_route(path: Vec<Vec2>) -> Vec<Vec2> {
    let mut simplified = Vec::with_capacity(path.len());
    for point in path {
        if let Some(previous) = simplified.last().copied() {
            if same_point(previous, point) {
                continue;
            }
            if simplified.len() >= 2 {
                let before = simplified[simplified.len() - 2];
                if axis_aligned(before, point) && axis_aligned(point, previous) {
                    simplified.pop();
                }
            }
        }
        simplified.push(point);
    }
    simplified
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bounds(x: f64, y: f64, width: f64, height: f64) -> Bounds {
        Bounds { x, y, width, height }
    }

    #[test]
    fn keeps_the_centered_route_when_no_obstacle_blocks_it() {
        let route = obstacle_aware_orthogonal_route(Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 100.0, y: 100.0 }, &[], 8.0);
        assert_eq!(
            route,
            centered_orthogonal_route(Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 100.0, y: 100.0 })
        );
    }

    #[test]
    fn routes_around_a_blocking_obstacle() {
        let route = obstacle_aware_orthogonal_route(
            Vec2 { x: 0.0, y: 50.0 },
            Vec2 { x: 200.0, y: 50.0 },
            &[bounds(75.0, 25.0, 50.0, 50.0)],
            10.0,
        );
        assert!(route.len() > 2);
        assert!(path_is_clear(
            &route,
            &[Rect { min_x: 65.0, max_x: 135.0, min_y: 15.0, max_y: 85.0 }]
        ));
        assert_eq!(
            route,
            obstacle_aware_orthogonal_route(
                Vec2 { x: 0.0, y: 50.0 },
                Vec2 { x: 200.0, y: 50.0 },
                &[bounds(75.0, 25.0, 50.0, 50.0)],
                10.0
            )
        );
    }
}

// The root entry point is a convenience API. Capability-oriented consumers
// should prefer ./model, ./geometry, ./commands, ./selection, ./interchange,
// and ./persistence so platform concerns remain visible at import sites.
export * from './actions';
export * from './arrow-geometry';
export * from './arrow-operations';
export * from './boolean-paths';
export * from './camera';
export * from './cards';
export * from './cursor';
export * from './export';
export * from './geom';
export * from './history';
export * from './interchange';
export * from './inspector';
export * from './layers';
export * from './layout';
export * from './math';
export * from './editor-model';
export type {
	GradientSpread,
	GradientStop,
	GradientTransform,
	GradientUnits,
	PaintValue
} from '@inkfinite/bindings/model';
export * from './path-topology';
export * from './path-metrics';
export * from './text-path';
export * from './paint';
export * from './reactivity';
export * from './selection';
export * from './snapping';
export * from './style-policy';
export * as stencils from './stencils';
export * from './tools';
export * from './vector-effects';

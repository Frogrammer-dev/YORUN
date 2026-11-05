/** UTF-8 bytes, including unknown fields in an imported file. */
export declare const MAX_ROUTE_BYTES = 2000000;
export declare const MAX_ROUTE_POINTS = 20000;

export interface RouteTransferInput {
  name: string;
  /** Coordinates in latitude, longitude order. */
  points: ReadonlyArray<readonly [number, number]>;
  /** Inclusive point indices delimiting a moving section between drawing strokes. */
  moves?: ReadonlyArray<readonly [number, number]>;
}

export interface RouteTransfer {
  format: 'yorun.route';
  version: 1;
  name: string;
  points: [number, number][];
  moves: [number, number][];
  /** Recomputed from all coordinates, including moving sections. */
  lengthMeters: number;
}

/** Throws a Korean Error for invalid or unsupported file contents. */
export declare function parseRouteTransfer(text: string): RouteTransfer;
/** Validates and deeply copies the course, removing unknown fields. */
export declare function createRouteTransfer(input: RouteTransferInput): RouteTransfer;
/** Revalidates and normalizes the course before serialization. */
export declare function stringifyRouteTransfer(route: RouteTransfer): string;

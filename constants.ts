
import type { AllowedView, UserRole, Phase } from './src/types';

export const WAREHOUSE_AREAS = [
  // A1–A10
  ...Array.from({ length: 10 }, (_, i) => `A${i + 1}`),

  // B1–B5
  ...Array.from({ length: 5 }, (_, i) => `B${i + 1}`),

  // O
  "O",
] as const;

export const WAREHOUSE_POSITIONS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9,
] as const;

export const ALL_ALLOWED_VIEWS: AllowedView[] = [
  "operator","search","manager","batch-create","transactions","orders",
  "scan-product-sheet","daily-logs",
  "phase-manager","pdf-import","live-phases","history","account","dead-time","frames",
  "material-use"
];
export const USER_SELECTABLE_TABS: AllowedView[] = ['operator', 'search', 'batch-create', 'transactions'];
export const ALL_ROLES: UserRole[] = [
  "operator","manager","orderkeeper","machineoperator",
  "infraoperator","storekeeper","framekeeper",
  "materiallogger","warehousemanager"
];

// New Constants for Production Phases
export const PHASES: Phase[] = [
    { id: '1', name: 'Phase 1: Cutting' },
    { id: '2', name: 'Phase 2: Material Prep' },
    { id: '3', name: 'Phase 3: Assembly' },
    { id: '10', name: 'Phase 10: Painting' },
    { id: '20', name: 'Phase 20: Quality Check' },
    { id: '30', name: 'Phase 30: Special Prep' },
    { id: '99', name: 'Phase 99: Packaging' }
];
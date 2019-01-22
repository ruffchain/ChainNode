export interface IConsistency {
    beginConsistency(): Promise<void>;
    commitConsistency(): Promise<void>;
    rollbackConsistency(): Promise<void>;
}
/** Index entry of an Architecture Decision Record: written by the design slice, kept in the project state. */
export interface DecisionRecord {
  id: string;
  number: number;
  title: string;
  status: 'proposed' | 'accepted' | 'superseded' | 'deprecated';
  file: string;
  date: string;
}

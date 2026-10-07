import { useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { subscribeCoalesced } from './dataChanged.js';

export default function useDataChanged(resources, patientId, refetch) {
  const { subscribeDataChanged } = useSocket();
  const latest = useRef(refetch); latest.current = refetch;
  const resourceKey = [...resources].sort().join(',');
  useEffect(() => subscribeCoalesced(subscribeDataChanged, resourceKey.split(','), patientId, () => latest.current()), [subscribeDataChanged, resourceKey, patientId]);
}

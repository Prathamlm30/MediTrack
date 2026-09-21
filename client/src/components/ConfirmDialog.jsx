import Modal from './Modal.jsx';
import Button from './Button.jsx';
import s from './ConfirmDialog.module.css';
export default function ConfirmDialog({ open, onClose, onConfirm, title, consequence, confirmLabel = 'Confirm', destructive = false, loading = false }) {
  return <Modal open={open} onClose={loading ? () => {} : onClose} title={title} description={consequence}>
    <div className={s.actions}><Button variant="secondary" disabled={loading} onClick={onClose}>Cancel</Button>
      <Button variant={destructive ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></div>
  </Modal>;
}

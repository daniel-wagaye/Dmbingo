import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { patchName } from '../services/userService';

interface EditNameModalProps {
  currentName: string;
  onClose: () => void;
  onNameUpdated: (newName: string) => void;
}

const NAME_REGEX = /^[\p{L}\s'\-]{1,12}$/u;

export default function EditNameModal({ currentName, onClose, onNameUpdated }: EditNameModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);

  const handleInput = (value: string) => {
    setName(value.slice(0, 12));
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      toast.error(t('name_empty'));
      return;
    }
    if (!NAME_REGEX.test(trimmed)) {
      toast.error(t('name_invalid'));
      return;
    }

    setSaving(true);
    try {
      const res = await patchName(trimmed);
      onNameUpdated(res.first_name);
      toast.success(t('name_updated'));
      onClose();
    } catch (err: any) {
      if (err?.status === 429) {
        toast.error(t('name_rate_limit'));
      } else if (err?.status === 401) {
        toast.error(t('auth_failed'));
      } else if (err?.status === 400) {
        toast.error(err?.message || t('name_invalid'));
      } else {
        toast.error(t('something_went_wrong'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-glass" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{t('edit_name')}</h3>
        <input
          className="modal-input"
          type="text"
          value={name}
          onChange={(e) => handleInput(e.target.value)}
          maxLength={12}
          disabled={saving}
          autoFocus
        />
        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>
            {t('cancel')}
          </button>
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner-sm" /> : t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
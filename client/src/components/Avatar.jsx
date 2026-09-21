import { useState } from 'react';
import s from './Avatar.module.css';
export default function Avatar({ fullName = 'User', profilePictureUrl }) {
  const [failed, setFailed] = useState(null);
  return profilePictureUrl && failed !== profilePictureUrl
    ? <img className={s.avatar} src={profilePictureUrl} alt={fullName} onError={() => setFailed(profilePictureUrl)} />
    : <span className={s.avatar} role="img" aria-label={fullName}>{fullName.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('')}</span>;
}

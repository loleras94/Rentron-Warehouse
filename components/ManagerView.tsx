import React, { useState, useEffect, useMemo } from 'react';
import type { User, UserRole } from '../src/types';
import * as api from '../api/client';
import { CloseIcon, UserGroupIcon } from './Icons';
import { ALL_ROLES } from '../constants';
import { useTranslation } from '../hooks/useTranslation';


// --- User Creation/Editing Modal ---
const UserModal: React.FC<{ user: User | null; onClose: () => void; onSave: () => void }> = ({
  user,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation();
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<UserRole[]>(user?.roles || []);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isEditMode = useMemo(() => !!user?.id, [user]);
  const isEditingManager = useMemo(() => isEditMode && !!user?.roles.includes('manager'), [isEditMode, user]);

  const handleRoleChange = (role: UserRole, checked: boolean) => {
    if (role === 'manager' && isEditingManager && !checked) return; // Prevent unchecking manager

    setRoles(prevRoles => {
      if (checked) {
        return [...new Set([...prevRoles, role])];
      } else {
        return prevRoles.filter(r => r !== role);
      }
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username || (!password && !isEditMode) || roles.length === 0) {
      setError(t('manager.userModal.errorFillFields'));
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditMode) {
        await api.updateUser(user!.id, { roles, password });
      } else {
        // ✅ Simpler: let backend logic decide allowedTabs
        await api.createUser({ username, password, roles });
      }

      onSave();
      onClose();
    } catch (err: any) {
      setError(err.message || 'An error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputStyles =
    'block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-5 border-b flex justify-between items-center">
          <h3 className="text-xl font-semibold text-gray-800">
            {isEditMode ? t('manager.userModal.editTitle') : t('manager.userModal.createTitle')}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" disabled={isSubmitting}>
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">{t('manager.userModal.usernameLabel')}</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className={`mt-1 ${inputStyles}`}
              required
              disabled={isSubmitting || isEditMode}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              {isEditMode ? t('manager.userModal.newPasswordLabel') : t('manager.userModal.passwordLabel')}
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className={`mt-1 ${inputStyles}`}
              required={!isEditMode}
              disabled={isSubmitting}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">{t('manager.userModal.roleLabel')}</label>
            <div className="mt-2 space-y-2">
              {ALL_ROLES.map(r => (
                <div key={r} className="flex items-center">
                  <input
                    id={`role-${r}`}
                    type="checkbox"
                    value={r}
                    checked={roles.includes(r)}
                    onChange={e => handleRoleChange(r, e.target.checked)}
                    disabled={isSubmitting || (isEditingManager && r === 'manager')}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                  />
                  <label
                    htmlFor={`role-${r}`}
                    className={`ml-3 block text-sm font-medium ${
                      isEditingManager && r === 'manager' ? 'text-gray-500' : 'text-gray-700'
                    }`}
                  >
                    {t(`roles.${r}`)}
                    {isEditingManager && r === 'manager' && ` (${t('manager.userModal.nonRemovable')})`}
                  </label>
                </div>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-100 p-2 rounded-md">{error}</p>}
          <div className="pt-4 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 font-medium bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed"
              disabled={isSubmitting}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="px-4 py-2 font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed"
              disabled={isSubmitting}
            >
              {isSubmitting ? t('manager.userModal.savingButton') : t('manager.userModal.saveButton')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// --- Main Manager View Component ---
const ManagerView: React.FC = () => {
  const { language, changeLanguage, t } = useTranslation(); // Use translation context for language and changeLanguage function
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const userList = await api.getUsers();
      setUsers(userList);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const formatTimestamp = (isoString: string | null) => {
    if (!isoString) return t('common.na');
    return new Date(isoString).toLocaleString();
  };

  const handleSave = () => fetchUsers();
  const handleCreateUser = () => {
    setEditingUser(null);
    setIsModalOpen(true);
  };
  const handleEditUser = (user: User) => {
    setEditingUser(user);
    setIsModalOpen(true);
  };
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
  };

  const handleExport = () => {
    const headers = ['ID', 'Username', 'Roles', 'AllowedTabs', 'CreatedAt', 'LastLogin'];
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      headers.join(',') +
      '\n' +
      users
        .map(u =>
          [u.id, u.username, `"${u.roles.join(';')}"`, `"${u.allowedTabs.join(';')}"`, u.createdAt, u.lastLogin].join(',')
        )
        .join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'users_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-700 flex items-center">
          <UserGroupIcon className="w-7 h-7 mr-2 text-indigo-600" />
          {t('manager.title')}
        </h2>
        <div>
          <button
            onClick={handleExport}
            className="px-4 py-2 font-medium bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 mr-2"
          >
            {t('manager.exportCsv')}
          </button>
          <button
            onClick={handleCreateUser}
            className="px-4 py-2 font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            {t('manager.createNewUser')}
          </button>
        </div>
      </div>

      {/* Language Settings */}
      <div className="bg-gray-50 p-4 rounded-md mb-6 border border-gray-200">
        <h3 className="text-lg font-medium text-gray-800 mb-2">{t('manager.languageSettings.title')}</h3>
        <div className="flex space-x-2">
          <button
            onClick={() => changeLanguage('en')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              language === 'en'
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
            }`}
          >
            English
          </button>
          <button
            onClick={() => changeLanguage('el')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              language === 'el'
                ? 'bg-indigo-600 text-white shadow'
                : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
            }`}
          >
            Ελληνικά (Greek)
          </button>
        </div>
      </div>

      {/* Users Table */}
      {loading && <p>{t('manager.loading')}</p>}
      {error && <p className="text-red-500">{error}</p>}
      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('manager.table.username')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('manager.table.role')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('manager.table.lastLogin')}
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('manager.table.actions')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {t('manager.table.allowedTabs')}
                </th>                
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {users.map(user => (
                <tr key={user.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{user.username}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <div className="flex flex-wrap gap-1">
                      {user.roles.map(role => (
                        <span
                          key={role}
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            role === 'manager' ? 'bg-indigo-100 text-indigo-800' : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {t(`roles.${role}`)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatTimestamp(user.lastLogin)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleEditUser(user)}
                      className="text-indigo-600 hover:text-indigo-900 font-semibold"
                    >
                      {t('common.edit')}
                    </button>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {user.allowedTabs.map(tab => t(`tabs.${tab}`)).join(', ')}
                  </td>                  
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal for editing/creating user */}
      {isModalOpen && <UserModal user={editingUser} onClose={handleCloseModal} onSave={handleSave} />}
    </div>
  );
};

export default ManagerView;


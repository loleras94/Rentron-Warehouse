import React from "react";

const ConfirmModal = ({ open, title, message, buttons, onClose }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold mb-3">{title}</h2>
        <p className="text-gray-700 mb-6 whitespace-pre-line">{message}</p>

        <div className="flex flex-col gap-3">
          {buttons.map((btn, idx) => (
            <button
              key={idx}
              onClick={btn.onClick}
              className={
                "w-full py-2 rounded font-semibold " +
                (btn.type === "primary"
                  ? "bg-indigo-600 text-white hover:bg-indigo-700"
                  : btn.type === "danger"
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-gray-200 text-gray-900 hover:bg-gray-300")
              }
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;

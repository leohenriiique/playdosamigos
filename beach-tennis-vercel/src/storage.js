// Armazenamento simples baseado em localStorage do navegador.
// Mantém a mesma "forma" de retorno (get/set assíncronos) usada no app,
// para que o restante do código não precise ser alterado.
const storage = {
  async get(key) {
    try {
      const value = window.localStorage.getItem(key);
      if (value === null) return null;
      return { key, value };
    } catch (e) {
      return null;
    }
  },
  async set(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return { key, value };
    } catch (e) {
      return null;
    }
  },
};

export default storage;

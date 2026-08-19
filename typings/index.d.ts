/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    currentUser: import('./types/participant').Participant | null;
  };
}
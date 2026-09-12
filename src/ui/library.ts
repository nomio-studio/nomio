import type { MapRecord, SaveLibraryController, SaveRecord } from "../game/save-system";
import { requireElement } from "./dom";

export interface SaveLibraryOptions {
  container: HTMLElement;
  controller: SaveLibraryController;
  /** Called when the player opens a save; the host swaps the game session. */
  onLoad: (mapId: string, saveId: string) => void;
  onClosed?: () => void;
}

type FormMode =
  | { kind: "create-map" }
  | { kind: "rename-map"; mapId: string }
  | { kind: "create-save" }
  | { kind: "rename-save"; saveId: string };

type ConfirmMode = { kind: "map" | "save"; id: string } | null;

const formatDate = (timestamp: number): string =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);

const pluralize = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

/**
 * The worlds library: browse worlds (maps) and their save slots, then create,
 * rename, duplicate, delete, or open them. It owns only presentation and state;
 * every mutation goes through the `SaveLibraryController`.
 */
export class SaveLibrary {
  private readonly listeners = new AbortController();
  private readonly root: HTMLDialogElement;
  private readonly mapList: HTMLElement;
  private readonly saveList: HTMLElement;
  private readonly mapForm: HTMLFormElement;
  private readonly saveForm: HTMLFormElement;
  private readonly mapName: HTMLInputElement;
  private readonly mapSeed: HTMLInputElement;
  private readonly mapSeedLabel: HTMLLabelElement;
  private readonly mapSubmit: HTMLButtonElement;
  private readonly saveName: HTMLInputElement;
  private readonly saveSubmit: HTMLButtonElement;
  private readonly newSaveButton: HTMLButtonElement;
  private readonly savesMeta: HTMLElement;
  private readonly status: HTMLElement;

  private maps: MapRecord[] = [];
  private saves: SaveRecord[] = [];
  private selectedMapId: string | null = null;
  private activeMapId: string | null = null;
  private activeSaveId: string | null = null;
  private mapFormMode: FormMode | null = null;
  private saveFormMode: FormMode | null = null;
  private confirming: ConfirmMode = null;
  private busy = false;

  public constructor(private readonly options: SaveLibraryOptions) {
    options.container.insertAdjacentHTML(
      "beforeend",
      `
      <dialog class="dialog dialog--library" id="save-library" aria-labelledby="library-heading">
        <div class="dialog__panel library">
          <header class="library__header">
            <div>
              <p class="eyebrow">Worlds</p>
              <h2 class="dialog__title" id="library-heading">Your islands</h2>
            </div>
            <button class="button button--quiet library__close" id="library-close" type="button">Close</button>
          </header>

          <div class="library__columns">
            <section class="library__column" aria-labelledby="library-maps-heading">
              <div class="library__section-head">
                <h3 class="library__section-title" id="library-maps-heading">Worlds</h3>
                <button class="button button--ghost library__new" id="library-new-map" type="button">New</button>
              </div>
              <ul class="library__list" id="library-map-list"></ul>
              <form class="library__form" id="library-map-form" hidden>
                <label class="field__label" for="library-map-name">Name</label>
                <input class="library__input" id="library-map-name" name="name" type="text"
                  maxlength="48" autocomplete="off" required />
                <label class="field__label" for="library-map-seed" id="library-map-seed-label">Seed</label>
                <input class="library__input" id="library-map-seed" name="seed" type="number"
                  inputmode="numeric" step="1" />
                <div class="library__form-actions">
                  <button class="button button--primary" id="library-map-submit" type="submit">Create</button>
                  <button class="button button--quiet" id="library-map-cancel" type="button">Cancel</button>
                </div>
              </form>
            </section>

            <section class="library__column" aria-labelledby="library-saves-heading">
              <div class="library__section-head">
                <h3 class="library__section-title" id="library-saves-heading">Saves</h3>
                <button class="button button--ghost library__new" id="library-new-save" type="button" disabled>New</button>
              </div>
              <p class="library__meta" id="library-saves-meta"></p>
              <ul class="library__list" id="library-save-list"></ul>
              <form class="library__form" id="library-save-form" hidden>
                <label class="field__label" for="library-save-name">Name</label>
                <input class="library__input" id="library-save-name" name="name" type="text"
                  maxlength="48" autocomplete="off" required />
                <div class="library__form-actions">
                  <button class="button button--primary" id="library-save-submit" type="submit">Create</button>
                  <button class="button button--quiet" id="library-save-cancel" type="button">Cancel</button>
                </div>
              </form>
            </section>
          </div>

          <p class="library__status" id="library-status" role="status" aria-live="polite"></p>
        </div>
      </dialog>
    `,
    );

    this.root = requireElement<HTMLDialogElement>(options.container, "#save-library");
    this.mapList = requireElement<HTMLElement>(this.root, "#library-map-list");
    this.saveList = requireElement<HTMLElement>(this.root, "#library-save-list");
    this.mapForm = requireElement<HTMLFormElement>(this.root, "#library-map-form");
    this.saveForm = requireElement<HTMLFormElement>(this.root, "#library-save-form");
    this.mapName = requireElement<HTMLInputElement>(this.root, "#library-map-name");
    this.mapSeed = requireElement<HTMLInputElement>(this.root, "#library-map-seed");
    this.mapSeedLabel = requireElement<HTMLLabelElement>(this.root, "#library-map-seed-label");
    this.mapSubmit = requireElement<HTMLButtonElement>(this.root, "#library-map-submit");
    this.saveName = requireElement<HTMLInputElement>(this.root, "#library-save-name");
    this.saveSubmit = requireElement<HTMLButtonElement>(this.root, "#library-save-submit");
    this.newSaveButton = requireElement<HTMLButtonElement>(this.root, "#library-new-save");
    this.savesMeta = requireElement<HTMLElement>(this.root, "#library-saves-meta");
    this.status = requireElement<HTMLElement>(this.root, "#library-status");

    const { signal } = this.listeners;
    this.root.addEventListener("cancel", this.handleCancel, { signal });
    this.root.addEventListener("close", () => this.options.onClosed?.(), { signal });
    requireElement<HTMLButtonElement>(this.root, "#library-close").addEventListener(
      "click",
      () => this.close(),
      { signal },
    );
    requireElement<HTMLButtonElement>(this.root, "#library-new-map").addEventListener(
      "click",
      () => this.openMapForm({ kind: "create-map" }),
      { signal },
    );
    this.newSaveButton.addEventListener("click", () => this.openSaveForm({ kind: "create-save" }), {
      signal,
    });
    requireElement<HTMLButtonElement>(this.root, "#library-map-cancel").addEventListener(
      "click",
      () => this.closeMapForm(),
      { signal },
    );
    requireElement<HTMLButtonElement>(this.root, "#library-save-cancel").addEventListener(
      "click",
      () => this.closeSaveForm(),
      { signal },
    );
    this.mapForm.addEventListener("submit", this.handleMapSubmit, { signal });
    this.saveForm.addEventListener("submit", this.handleSaveSubmit, { signal });
  }

  public get isOpen(): boolean {
    return this.root.open;
  }

  public open(active?: { mapId: string | null; saveId: string | null } | null): void {
    this.activeMapId = active?.mapId ?? null;
    this.activeSaveId = active?.saveId ?? null;
    this.selectedMapId = this.activeMapId;
    this.confirming = null;
    this.closeMapForm();
    this.closeSaveForm();
    if (!this.root.open) {
      this.root.showModal();
    }
    this.setStatus("Reading your worlds…");
    void this.refresh();
  }

  public close(): void {
    if (this.root.open) {
      this.root.close();
    }
  }

  public dispose(): void {
    this.listeners.abort();
    this.root.remove();
  }

  private async refresh(): Promise<void> {
    try {
      this.maps = await this.options.controller.listMaps();
      if (this.selectedMapId === null || !this.maps.some((map) => map.id === this.selectedMapId)) {
        const preferred = this.activeMapId;
        this.selectedMapId =
          preferred && this.maps.some((map) => map.id === preferred)
            ? preferred
            : (this.maps[0]?.id ?? null);
      }
      this.saves = this.selectedMapId
        ? await this.options.controller.listSaves(this.selectedMapId)
        : [];
      this.setStatus("");
    } catch {
      this.setStatus("Could not read your worlds. Storage may be unavailable.");
    }
    this.render();
  }

  private render(): void {
    this.renderMaps();
    this.renderSaves();
  }

  private renderMaps(): void {
    this.mapList.replaceChildren();
    if (this.maps.length === 0) {
      this.mapList.append(this.emptyRow("No worlds yet. Create one to begin."));
      return;
    }

    for (const map of this.maps) {
      const item = document.createElement("li");
      item.className = "library-item";
      if (map.id === this.selectedMapId) {
        item.classList.add("is-selected");
      }
      if (map.id === this.activeMapId) {
        item.classList.add("is-active");
      }

      if (this.confirming?.kind === "map" && this.confirming.id === map.id) {
        item.append(
          this.confirmRow(
            `Delete “${map.name}” and all of its saves?`,
            () => this.deleteMap(map.id),
            () => this.clearConfirm(),
          ),
        );
        this.mapList.append(item);
        continue;
      }

      const select = document.createElement("button");
      select.type = "button";
      select.className = "library-item__main";
      select.setAttribute("aria-pressed", String(map.id === this.selectedMapId));
      select.addEventListener("click", () => {
        this.selectedMapId = map.id;
        this.confirming = null;
        void this.refresh();
      });
      select.append(this.label(map.name, "library-item__name"));
      select.append(this.label(`Updated ${formatDate(map.updatedAt)}`, "library-item__meta"));

      const actions = document.createElement("div");
      actions.className = "library-item__actions";
      actions.append(
        this.iconAction("Rename", () => this.openMapForm({ kind: "rename-map", mapId: map.id })),
      );
      // The live world is being autosaved; deleting it would orphan the session.
      if (map.id !== this.activeMapId) {
        actions.append(
          this.iconAction(
            "Delete",
            () => this.requestConfirm("map", map.id),
            "library-item__action--danger",
          ),
        );
      }

      item.append(select, actions);
      this.mapList.append(item);
    }
  }

  private renderSaves(): void {
    this.saveList.replaceChildren();
    const map = this.maps.find((candidate) => candidate.id === this.selectedMapId);
    this.newSaveButton.disabled = map === undefined || this.busy;
    this.savesMeta.textContent = map
      ? `Seed ${map.terrain.seed} · ${pluralize(this.saves.length, "save")}`
      : "";
    if (!map) {
      this.saveList.append(this.emptyRow("Choose a world to see its saves."));
      return;
    }
    if (this.saves.length === 0) {
      this.saveList.append(this.emptyRow("No saves yet. Create one to begin."));
      return;
    }

    for (const save of this.saves) {
      const item = document.createElement("li");
      item.className = "library-item";
      if (save.id === this.activeSaveId && map.id === this.activeMapId) {
        item.classList.add("is-active");
      }

      if (this.confirming?.kind === "save" && this.confirming.id === save.id) {
        item.append(
          this.confirmRow(
            `Delete “${save.name}”?`,
            () => this.deleteSave(map.id, save.id),
            () => this.clearConfirm(),
          ),
        );
        this.saveList.append(item);
        continue;
      }

      const main = document.createElement("div");
      main.className = "library-item__main library-item__main--static";
      main.append(this.label(save.name, "library-item__name"));
      main.append(
        this.label(
          `${pluralize(save.editedChunks, "edit")} · ${formatDate(save.updatedAt)}`,
          "library-item__meta",
        ),
      );

      const actions = document.createElement("div");
      actions.className = "library-item__actions";
      actions.append(
        this.iconAction("Open", () => this.load(map.id, save.id), "library-item__action--primary"),
        this.iconAction("Duplicate", () => this.duplicateSave(map.id, save.id)),
        this.iconAction("Rename", () =>
          this.openSaveForm({ kind: "rename-save", saveId: save.id }),
        ),
      );
      // The active save is being autosaved; deleting it would orphan the session.
      if (!(save.id === this.activeSaveId && map.id === this.activeMapId)) {
        actions.append(
          this.iconAction(
            "Delete",
            () => this.requestConfirm("save", save.id),
            "library-item__action--danger",
          ),
        );
      }

      item.append(main, actions);
      this.saveList.append(item);
    }
  }

  private openMapForm(mode: FormMode): void {
    this.mapFormMode = mode;
    this.mapForm.hidden = false;
    const isCreate = mode.kind === "create-map";
    this.mapSeedLabel.hidden = !isCreate;
    this.mapSeed.hidden = !isCreate;
    this.mapSeed.required = isCreate;
    this.mapSubmit.textContent = isCreate ? "Create" : "Save";
    if (mode.kind === "rename-map") {
      const map = this.maps.find((candidate) => candidate.id === mode.mapId);
      this.mapName.value = map?.name ?? "";
      this.mapSeed.value = String(map?.terrain.seed ?? "");
    } else {
      this.mapName.value = "";
      this.mapSeed.value = String(Math.floor(Math.random() * 0xffffffff) >>> 0);
    }
    this.mapName.focus();
    this.mapName.select();
  }

  private closeMapForm(): void {
    this.mapFormMode = null;
    this.mapForm.hidden = true;
  }

  private openSaveForm(mode: FormMode): void {
    if (!this.selectedMapId) {
      return;
    }
    this.saveFormMode = mode;
    this.saveForm.hidden = false;
    this.saveSubmit.textContent = mode.kind === "create-save" ? "Create" : "Save";
    if (mode.kind === "rename-save") {
      const save = this.saves.find((candidate) => candidate.id === mode.saveId);
      this.saveName.value = save?.name ?? "";
    } else {
      this.saveName.value = "";
    }
    this.saveName.focus();
    this.saveName.select();
  }

  private closeSaveForm(): void {
    this.saveFormMode = null;
    this.saveForm.hidden = true;
  }

  private readonly handleMapSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const mode = this.mapFormMode;
    if (!mode) {
      return;
    }
    const name = this.mapName.value;
    const seed = Math.trunc(Number(this.mapSeed.value));
    void this.run(async () => {
      if (mode.kind === "create-map") {
        const map = await this.options.controller.createMap({ name, seed });
        this.selectedMapId = map.id;
      } else if (mode.kind === "rename-map") {
        await this.options.controller.renameMap(mode.mapId, name);
      }
      this.closeMapForm();
    });
  };

  private readonly handleSaveSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    const mode = this.saveFormMode;
    const mapId = this.selectedMapId;
    if (!mode || !mapId) {
      return;
    }
    const name = this.saveName.value;
    void this.run(async () => {
      if (mode.kind === "create-save") {
        await this.options.controller.createSave(mapId, name);
      } else if (mode.kind === "rename-save") {
        await this.options.controller.renameSave(mapId, mode.saveId, name);
      }
      this.closeSaveForm();
    });
  };

  private load(mapId: string, saveId: string): void {
    this.options.onLoad(mapId, saveId);
    this.close();
  }

  private async deleteMap(mapId: string): Promise<void> {
    await this.run(async () => {
      await this.options.controller.deleteMap(mapId);
      if (this.selectedMapId === mapId) {
        this.selectedMapId = this.activeMapId === mapId ? null : this.activeMapId;
      }
      this.confirming = null;
    });
  }

  private async deleteSave(mapId: string, saveId: string): Promise<void> {
    await this.run(async () => {
      await this.options.controller.deleteSave(mapId, saveId);
      this.confirming = null;
    });
  }

  private async duplicateSave(mapId: string, saveId: string): Promise<void> {
    await this.run(async () => {
      await this.options.controller.duplicateSave(mapId, saveId);
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.render();
    let failed = false;
    try {
      await action();
    } catch {
      failed = true;
    }
    this.busy = false;
    await this.refresh();
    if (failed) {
      this.setStatus("That action could not be completed.");
    }
  }

  private requestConfirm(kind: "map" | "save", id: string): void {
    this.confirming = { kind, id };
    this.render();
  }

  private clearConfirm(): void {
    this.confirming = null;
    this.render();
  }

  private confirmRow(message: string, onConfirm: () => void, onCancel: () => void): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "library-confirm";
    wrapper.append(this.label(message, "library-confirm__text"));
    const actions = document.createElement("div");
    actions.className = "library-confirm__actions";
    actions.append(
      this.iconAction("Delete", onConfirm, "library-item__action--danger"),
      this.iconAction("Keep", onCancel),
    );
    wrapper.append(actions);
    return wrapper;
  }

  private emptyRow(message: string): HTMLElement {
    const item = document.createElement("li");
    item.className = "library-empty";
    item.textContent = message;
    return item;
  }

  private label(text: string, className: string): HTMLElement {
    const element = document.createElement("span");
    element.className = className;
    element.textContent = text;
    return element;
  }

  private iconAction(label: string, onClick: () => void, extraClass = ""): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `library-item__action ${extraClass}`.trim();
    button.textContent = label;
    button.disabled = this.busy;
    button.addEventListener("click", onClick);
    return button;
  }

  private setStatus(message: string): void {
    this.status.textContent = message;
  }

  private readonly handleCancel = (event: Event): void => {
    event.preventDefault();
    this.close();
  };
}

import { gif } from "./gif.js";
import { card } from "./card.js";
import { like } from "./like.js";
import { util } from "../../common/util.js";
import { pagination } from "./pagination.js";
import { dto } from "../../connection/dto.js";
import { lang } from "../../common/language.js";
import { storage } from "../../common/storage.js";
import { session } from "../../common/session.js";
import {
  request,
  HTTP_GET,
  HTTP_POST,
  HTTP_DELETE,
  HTTP_PUT,
  HTTP_STATUS_CREATED,
} from "../../connection/request.js";

export const comment = (() => {
  /**
   * @type {ReturnType<typeof storage>|null}
   */
  let owns = null;

  /**
   * @type {ReturnType<typeof storage>|null}
   */
  let showHide = null;

  /**
   * @type {HTMLElement|null}
   */
  let comments = null;

  /**
   * @type {string[]}
   */
  const lastRender = [];

  /**
   * @returns {string}
   */
  const onNullComment = () => {
    const desc = lang
      .on("id", "📢 Yuk, share undangan ini biar makin rame komentarnya! 🎉")
      .on("en", "📢 Let's share this invitation to get more comments! 🎉")
      .on(
        "vi",
        "📢 Hãy chia sẻ thiệp mời này để có thêm nhiều lời chúc hơn nhé! 🎉",
      )
      .get();

    return `<div class="text-center p-4 mx-0 mt-0 mb-3 bg-theme-auto rounded-4 shadow"><p class="fw-bold p-0 m-0" style="font-size: 0.95rem;">${desc}</p></div>`;
  };

  /**
   * @param {string} id
   * @param {boolean} disabled
   * @returns {void}
   */
  const changeActionButton = (id, disabled) => {
    document
      .querySelector(`[data-button-action="${id}"]`)
      .childNodes.forEach((e) => {
        e.disabled = disabled;
      });
  };

  /**
   * @param {string} id
   * @returns {void}
   */
  const removeInnerForm = (id) => {
    changeActionButton(id, false);
    document.getElementById(`inner-${id}`).remove();
  };

  /**
   * @param {HTMLButtonElement} button
   * @returns {void}
   */
  const showOrHide = (button) => {
    const ids = button.getAttribute("data-uuids").split(",");
    const isShow = button.getAttribute("data-show") === "true";
    const uuid = button.getAttribute("data-uuid");
    const currentShow = showHide.get("show");

    button.setAttribute("data-show", isShow ? "false" : "true");
    button.innerText = isShow ? `Show replies (${ids.length})` : "Hide replies";
    showHide.set(
      "show",
      isShow ? currentShow.filter((i) => i !== uuid) : [...currentShow, uuid],
    );

    for (const id of ids) {
      showHide.set(
        "hidden",
        showHide.get("hidden").map((i) => {
          if (i.uuid === id) {
            i.show = !isShow;
          }

          return i;
        }),
      );

      document.getElementById(id).classList.toggle("d-none", isShow);
    }
  };

  /**
   * @param {HTMLAnchorElement} anchor
   * @param {string} uuid
   * @returns {void}
   */
  const showMore = (anchor, uuid) => {
    const content = document.getElementById(`content-${uuid}`);
    const original = util.base64Decode(content.getAttribute("data-comment"));
    const isCollapsed = anchor.getAttribute("data-show") === "false";

    util.safeInnerHTML(
      content,
      util.convertMarkdownToHTML(
        util.escapeHtml(
          isCollapsed
            ? original
            : original.slice(0, card.maxCommentLength) + "...",
        ),
      ),
    );
    anchor.innerText = isCollapsed ? "Sebagian" : "Selengkapnya";
    anchor.setAttribute("data-show", isCollapsed ? "true" : "false");
  };

  /**
   * @param {ReturnType<typeof dto.getCommentResponse>} c
   * @returns {Promise<void>}
   */
  const fetchTracker = async (c) => {
    if (c.comments) {
      await Promise.all(c.comments.map((v) => fetchTracker(v)));
    }

    if (!c.ip || !c.user_agent || c.is_admin) {
      return;
    }

    /**
     * @param {string} result
     * @returns {void}
     */
    const setResult = (result) => {
      const commentIp = document.getElementById(
        `ip-${util.escapeHtml(c.uuid)}`,
      );
      util.safeInnerHTML(
        commentIp,
        `<i class="fa-solid fa-location-dot me-1"></i>${util.escapeHtml(c.ip)} <strong>${util.escapeHtml(result)}</strong>`,
      );
    };

    // Free for commercial and non-commercial use.
    await request(HTTP_GET, `https://apip.cc/api-json/${c.ip}`)
      .withCache()
      .withRetry()
      .default()
      .then((res) => res.json())
      .then((res) => {
        let result = "localhost";

        if (res.status === "success") {
          if (res.City.length !== 0 && res.RegionName.length !== 0) {
            result = res.City + " - " + res.RegionName;
          } else if (res.Capital.length !== 0 && res.CountryName.length !== 0) {
            result = res.Capital + " - " + res.CountryName;
          }
        }

        setResult(result);
      })
      .catch((err) => setResult(err.message));
  };

  /**
   * @param {ReturnType<typeof dto.getCommentsResponse>} items
   * @param {ReturnType<typeof dto.commentShowMore>[]} hide
   * @returns {ReturnType<typeof dto.commentShowMore>[]}
   */
  const traverse = (items, hide = []) => {
    const dataShow = showHide.get("show");

    const buildHide = (lists) =>
      lists.forEach((item) => {
        if (hide.find((i) => i.uuid === item.uuid)) {
          buildHide(item.comments);
          return;
        }

        hide.push(dto.commentShowMore(item.uuid));
        buildHide(item.comments);
      });

    const setVisible = (lists) =>
      lists.forEach((item) => {
        if (!dataShow.includes(item.uuid)) {
          setVisible(item.comments);
          return;
        }

        item.comments.forEach((c) => {
          const i = hide.findIndex((h) => h.uuid === c.uuid);
          if (i !== -1) {
            hide[i].show = true;
          }
        });

        setVisible(item.comments);
      });

    buildHide(items);
    setVisible(items);

    return hide;
  };

  /**
   * @returns {Promise<ReturnType<typeof dto.getCommentsResponse>>}
   */
  const show = () => {
    // remove all event listener.
    lastRender.forEach((u) => {
      like.removeListener(u);
    });

    if (comments.getAttribute("data-loading") === "false") {
      comments.setAttribute("data-loading", "true");
      comments.innerHTML = card.renderLoading().repeat(pagination.getPer());
    }

    return request(
      HTTP_GET,
      `/api/v2/comment?per=${pagination.getPer()}&next=${pagination.getNext()}&lang=${lang.getLanguage()}`,
    )
      .token(session.getToken())
      .withCache(1000 * 30)
      .withForceCache()
      .send(dto.getCommentsResponseV2)
      .then(async (res) => {
        comments.setAttribute("data-loading", "false");

        for (const u of lastRender) {
          await gif.remove(u);
        }

        if (res.data.lists.length === 0) {
          comments.innerHTML = onNullComment();
          return res;
        }

        const flatten = (ii) =>
          ii.flatMap((i) => [i.uuid, ...flatten(i.comments)]);
        lastRender.splice(0, lastRender.length, ...flatten(res.data.lists));
        showHide.set(
          "hidden",
          traverse(res.data.lists, showHide.get("hidden")),
        );

        let data = await card.renderContentMany(res.data.lists);
        if (res.data.lists.length < pagination.getPer()) {
          data += onNullComment();
        }

        util.safeInnerHTML(comments, data);

        lastRender.forEach((u) => {
          like.addListener(u);
        });

        return res;
      })
      .then(async (res) => {
        comments.dispatchEvent(new Event("undangan.comment.result"));

        if (res.data.lists && session.isAdmin()) {
          await Promise.all(res.data.lists.map((v) => fetchTracker(v)));
        }

        pagination.setTotal(res.data.count);
        comments.dispatchEvent(new Event("undangan.comment.done"));
        return res;
      });
  };

  /**
   * @param {HTMLButtonElement} button
   * @returns {Promise<void>}
   */
  const remove = async (button) => {
    if (!util.ask("Are you sure?")) {
      return;
    }

    const id = button.getAttribute("data-uuid");

    if (session.isAdmin()) {
      owns.set(id, button.getAttribute("data-own"));
    }

    changeActionButton(id, true);
    const btn = util.disableButton(button);
    const likes = like.getButtonLike(id);
    likes.disabled = true;

    const status = await request(HTTP_DELETE, "/api/comment/" + owns.get(id))
      .token(session.getToken())
      .send(dto.statusResponse)
      .then((res) => res.data.status);

    if (!status) {
      btn.restore();
      likes.disabled = false;
      changeActionButton(id, false);
      return;
    }

    document
      .querySelectorAll('a[onclick="undangan.comment.showOrHide(this)"]')
      .forEach((n) => {
        const oldUuids = n.getAttribute("data-uuids").split(",");

        if (oldUuids.includes(id)) {
          const uuids = oldUuids.filter((i) => i !== id).join(",");
          uuids.length === 0 ? n.remove() : n.setAttribute("data-uuids", uuids);
        }
      });

    owns.unset(id);
    document.getElementById(id).remove();

    if (comments.children.length === 0) {
      comments.innerHTML = onNullComment();
    }
  };

  /**
   * @param {HTMLButtonElement} button
   * @returns {Promise<void>}
   */
  const update = async (button) => {
    const id = button.getAttribute("data-uuid");

    let isPresent = false;
    const presence = document.getElementById(`form-inner-presence-${id}`);
    if (presence) {
      presence.disabled = true;
      isPresent = presence.value === "1";
    }

    const badge = document.getElementById(`badge-${id}`);
    const isChecklist =
      !!badge && badge.getAttribute("data-is-presence") === "true";

    const gifIsOpen = gif.isOpen(id);
    const gifId = gif.getResultId(id);
    const gifCancel = gif.buttonCancel(id);

    if (gifIsOpen && gifId) {
      gifCancel.hide();
    }

    const form = document.getElementById(`form-inner-${id}`);

    if (
      id &&
      !gifIsOpen &&
      util.base64Encode(form.value) === form.getAttribute("data-original") &&
      isChecklist === isPresent
    ) {
      removeInnerForm(id);
      return;
    }

    if (!gifIsOpen && form.value?.trim().length === 0) {
      util.notify("Comments cannot be empty.").warning();
      return;
    }

    if (form) {
      form.disabled = true;
    }

    const cancel = document.querySelector(
      `[onclick="undangan.comment.cancel(this, '${id}')"]`,
    );
    if (cancel) {
      cancel.disabled = true;
    }

    const btn = util.disableButton(button);

    const status = await request(
      HTTP_PUT,
      `/api/comment/${owns.get(id)}?lang=${lang.getLanguage()}`,
    )
      .token(session.getToken())
      .body(
        dto.updateCommentRequest(
          presence ? isPresent : null,
          gifIsOpen ? null : form.value,
          gifId,
        ),
      )
      .send(dto.statusResponse)
      .then((res) => res.data.status);

    if (form) {
      form.disabled = false;
    }

    if (cancel) {
      cancel.disabled = false;
    }

    if (presence) {
      presence.disabled = false;
    }

    btn.restore();

    if (gifIsOpen && gifId) {
      gifCancel.show();
    }

    if (!status) {
      return;
    }

    if (gifIsOpen && gifId) {
      document.getElementById(`img-gif-${id}`).src = document
        .getElementById(`gif-result-${id}`)
        ?.querySelector("img").src;
      gifCancel.click();
    }

    removeInnerForm(id);

    if (!gifIsOpen) {
      const showButton = document.querySelector(
        `[onclick="undangan.comment.showMore(this, '${id}')"]`,
      );

      const content = document.getElementById(`content-${id}`);
      content.setAttribute("data-comment", util.base64Encode(form.value));

      const original = util.convertMarkdownToHTML(util.escapeHtml(form.value));
      if (form.value.length > card.maxCommentLength) {
        util.safeInnerHTML(
          content,
          showButton?.getAttribute("data-show") === "false"
            ? original.slice(0, card.maxCommentLength) + "..."
            : original,
        );
        showButton?.classList.replace("d-none", "d-block");
      } else {
        util.safeInnerHTML(content, original);
        showButton?.classList.replace("d-block", "d-none");
      }
    }

    if (presence) {
      document.getElementById("form-presence").value = isPresent ? "1" : "2";
      storage("information").set("presence", isPresent);
    }

    if (!presence || !badge) {
      return;
    }

    badge.classList.toggle("fa-circle-xmark", !isPresent);
    badge.classList.toggle("text-danger", !isPresent);

    badge.classList.toggle("fa-circle-check", isPresent);
    badge.classList.toggle("text-success", isPresent);
  };

  /**
   * @param {HTMLButtonElement} button
   * @returns {Promise<void>}
   */
  const send = async (button) => {
    // implement this function using native fetch API without using request function.
    const name = document.getElementById("form-name").value?.trim() ?? "";
    if (name.length === 0) {
      util.notify("Name cannot be empty.").warning();
      return;
    }
    const presence = Number(document.getElementById("form-presence").value);
    const message = document.getElementById("form-comment").value?.trim() ?? "";
    const btn = util.disableButton(button);
    const status = await fetch("https://wedding-webapi.azurewebsites.net/wishes", {
      method: HTTP_POST,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: name,
        presence: presence,
        message: message
      }),
    });

    btn.restore();

    const errorEl = document.getElementById("wish-error");
    const successEl = document.getElementById("wish-success");

    if (status.status !== HTTP_STATUS_CREATED) {
      errorEl?.classList.remove("d-none");
      successEl?.classList.add("d-none");
      return;
    }

    errorEl?.classList.add("d-none");
    successEl?.classList.remove("d-none");
  };

  /**
   * @returns {Promise<void>}
   */
  const loadWishes = async () => {
    const container = document.getElementById("wish-content");
    if (!container) {
      return;
    }

    container.innerHTML = `<div class="d-flex justify-content-center align-items-center py-5">
      <div class="spinner-border text-secondary" role="status"><span class="visually-hidden">Loading...</span></div>
    </div>`;

    try {
      const res = await fetch("https://wedding-webapi.azurewebsites.net/wishes");
      if (!res.ok) {
        throw new Error(res.statusText);
      }
      const data = await res.json();
      const items = Array.isArray(data)
        ? data
        : (data.data ?? data.lists ?? []);

      if (items.length === 0) {
        container.innerHTML = `<p class="text-center" style="padding-top: 10rem;">Chúc mình mong nhận được lời chúc từ Quý khách ❤️</p>`;
        return;
      }

      container.innerHTML = `<div class="row row-cols-1 row-cols-sm-4 g-2">${items
        .map(
          (w) => `
        <div class="col">
          <div class="h-100 p-2 rounded-4 shadow-sm" style="background:rgba(255,255,255,0.6);">
            <div class="d-flex align-items-center gap-1 mb-1">
              <span>${util.escapeHtml(w.name ?? "")}</span>
            </div>
            ${w.message ? `<p class="mb-1">${util.escapeHtml(w.message)}</p>` : ""}
          </div>
        </div>`,
        )
        .join("")}</div>`;
    } catch {
      container.innerHTML = `<p class="text-center text-danger py-4">Không thể tải lời chúc, thử lại sau nhé 😭</p>`;
    }
  };

  /**
   * @param {HTMLButtonElement} button
   * @param {string} id
   * @returns {Promise<void>}
   */
  const cancel = async (button, id) => {
    const presence = document.getElementById(`form-inner-presence-${id}`);
    const isPresent = presence ? presence.value === "1" : false;

    const badge = document.getElementById(`badge-${id}`);
    const isChecklist =
      badge && owns.has(id) && presence
        ? badge.getAttribute("data-is-presence") === "true"
        : false;

    const btn = util.disableButton(button);

    if (
      gif.isOpen(id) &&
      ((!gif.getResultId(id) && isChecklist === isPresent) ||
        util.ask("Are you sure?"))
    ) {
      await gif.remove(id);
      removeInnerForm(id);
      return;
    }

    const form = document.getElementById(`form-inner-${id}`);
    if (
      form.value.length === 0 ||
      (util.base64Encode(form.value) === form.getAttribute("data-original") &&
        isChecklist === isPresent) ||
      util.ask("Are you sure?")
    ) {
      removeInnerForm(id);
      return;
    }

    btn.restore();
  };

  /**
   * @param {string} uuid
   * @returns {void}
   */
  const reply = (uuid) => {
    changeActionButton(uuid, true);

    gif.remove(uuid).then(() => {
      gif.onOpen(uuid, () => gif.removeGifSearch(uuid));
      document
        .getElementById(`button-${uuid}`)
        .insertAdjacentElement("afterend", card.renderReply(uuid));
    });
  };

  /**
   * @param {HTMLButtonElement} button
   * @param {boolean} is_parent
   * @returns {Promise<void>}
   */
  const edit = async (button, is_parent) => {
    const id = button.getAttribute("data-uuid");

    changeActionButton(id, true);

    if (session.isAdmin()) {
      owns.set(id, button.getAttribute("data-own"));
    }

    const badge = document.getElementById(`badge-${id}`);
    const isChecklist =
      !!badge && badge.getAttribute("data-is-presence") === "true";

    const gifImage = document.getElementById(`img-gif-${id}`);
    if (gifImage) {
      await gif.remove(id);
    }

    const isParent = is_parent && !session.isAdmin();
    document
      .getElementById(`button-${id}`)
      .insertAdjacentElement(
        "afterend",
        card.renderEdit(id, isChecklist, isParent, !!gifImage),
      );

    if (gifImage) {
      gif.onOpen(id, () => {
        gif.removeGifSearch(id);
        gif.removeButtonBack(id);
      });

      await gif.open(id);
      return;
    }

    const formInner = document.getElementById(`form-inner-${id}`);
    const original = util.base64Decode(
      document.getElementById(`content-${id}`)?.getAttribute("data-comment"),
    );

    formInner.value = original;
    formInner.setAttribute("data-original", util.base64Encode(original));
  };

  /**
   * @returns {void}
   */
  const init = () => {
    gif.init();
    like.init();
    card.init();
    pagination.init();

    comments = document.getElementById("comments");
    comments.addEventListener("undangan.comment.show", show);

    owns = storage("owns");
    showHide = storage("comment");

    if (!showHide.has("hidden")) {
      showHide.set("hidden", []);
    }

    if (!showHide.has("show")) {
      showHide.set("show", []);
    }
  };

  return {
    gif,
    like,
    pagination,
    init,
    send,
    edit,
    reply,
    remove,
    update,
    cancel,
    show,
    showMore,
    showOrHide,
    loadWishes,
  };
})();

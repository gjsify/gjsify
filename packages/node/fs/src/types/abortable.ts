export interface Abortable {
    /**
     * When provided the corresponding `AbortController` can be used to cancel an asynchronous action.
     */
    signal?: AbortSignal | undefined;
}